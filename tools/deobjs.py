# AVM1 control-flow-flattening deobfuscator + decompiler that emits runnable JavaScript
# for the kof-wing runtime (see runtime/js/as2.js for the `$` helpers).
#
# The obfuscator flattens control flow with a state variable whose name is made of
# control characters.  We trace the bytecode, evaluating those variables concretely,
# build expression trees for the real code, resolve short-circuit / ternary joins, and
# emit structured JS.  Leftover gotos become a labelled switch-loop.
import struct, math, re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from avm1 import decode

PROPS = ['_x','_y','_xscale','_yscale','_currentframe','_totalframes','_alpha','_visible','_width','_height','_rotation','_target','_framesloaded','_name','_droptarget','_url','_highquality','_focusrect','_soundbuftime','_quality','_xmouse','_ymouse']
JSRESERVED = set('break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await arguments eval'.split())

def is_obf(name):
    return isinstance(name, str) and name != '' and all(ord(c) < 32 for c in name)

class Undef:
    pass
UNDEF = Undef()

class C:  # constant
    __slots__ = ('v',)
    def __init__(s, v): s.v = v
    def __repr__(s): return lit(s.v)
class E:  # expression
    __slots__ = ('s', 'fx', 'neg', 'it')
    def __init__(s, t, fx=False, neg=None, it=False): s.s = t; s.fx = fx; s.neg = neg; s.it = it
    def __repr__(s): return s.s

IDRE = re.compile(r'^[A-Za-z_$][A-Za-z0-9_$]*$')
def jsstr(v):
    out = ['"']
    for ch in v:
        o = ord(ch)
        if ch == '\\': out.append('\\\\')
        elif ch == '"': out.append('\\"')
        elif ch == '\n': out.append('\\n')
        elif ch == '\r': out.append('\\r')
        elif o < 32 or 0x2028 <= o <= 0x2029: out.append('\\u%04x' % o)
        else: out.append(ch)
    out.append('"')
    return ''.join(out)
def lit(v):
    if v is None: return 'null'
    if v is True: return 'true'
    if v is False: return 'false'
    if isinstance(v, Undef): return 'undefined'
    if isinstance(v, str): return jsstr(v)
    if isinstance(v, float):
        if math.isnan(v): return 'NaN'
        if math.isinf(v): return 'Infinity' if v > 0 else '-Infinity'
        if v == int(v) and abs(v) < 1e15: v = int(v)
    if isinstance(v, (int, float)) and v < 0: return '(%r)' % v
    return repr(v)

def r(x): return repr(x)
def isident(s): return isinstance(s, str) and IDRE.match(s) is not None and s not in JSRESERVED

def num(v):
    if isinstance(v, bool): return 1.0 if v else 0.0
    if isinstance(v, (int, float)): return float(v)
    if v is None or isinstance(v, Undef): return float('nan')
    try: return float(v)
    except: return float('nan')
def tobool(v):
    if isinstance(v, str): return v != ''
    if isinstance(v, Undef) or v is None: return False
    if isinstance(v, float) and math.isnan(v): return False
    return bool(v)

BIN = {'Add': '+', 'Subtract': '-', 'Multiply': '*', 'Divide': '/', 'Equals': '==', 'Less': '<', 'And': '&&', 'Or': '||',
       'StringEquals': '==', 'Add2': '+', 'Less2': '<', 'Equals2': '==', 'Modulo': '%',
       'BitAnd': '&', 'BitOr': '|', 'BitXor': '^', 'BitLShift': '<<', 'BitRShift': '>>', 'BitURShift': '>>>',
       'StrictEquals': '===', 'Greater': '>', 'StringGreater': '>', 'StringLess': '<', 'InstanceOf': 'instanceof'}

def fold(op, a, b):
    try:
        if op == 'Add': return num(a) + num(b)
        if op == 'Add2':
            if isinstance(a, str) or isinstance(b, str) or isinstance(a, Undef) or isinstance(b, Undef) or a is None or b is None: return None
            return num(a) + num(b)
        if op == 'Subtract': return num(a) - num(b)
        if op == 'Multiply': return num(a) * num(b)
        if op == 'Divide': return num(a) / num(b) if num(b) != 0 else None
        if op == 'Modulo': return math.fmod(num(a), num(b))
        if op == 'Equals': return num(a) == num(b)
        if op in ('Equals2', 'StrictEquals'):
            if type(a) != type(b) and not (isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool) and not isinstance(b, bool)): return None
            return a == b
        if op in ('Less', 'Less2'):
            if isinstance(a, str) or isinstance(b, str): return None
            return num(a) < num(b)
        if op == 'Greater':
            if isinstance(a, str) or isinstance(b, str): return None
            return num(a) > num(b)
        if op in ('BitAnd', 'BitOr', 'BitXor', 'BitLShift', 'BitRShift'):
            x = int(num(a)) & 0xffffffff; y = int(num(b)) & 0xffffffff
            if x >= 2**31: x -= 2**32
            if y >= 2**31: y -= 2**32
            v = {'BitAnd': x & y, 'BitOr': x | y, 'BitXor': x ^ y, 'BitLShift': x << (y & 31), 'BitRShift': x >> (y & 31)}[op]
            v &= 0xffffffff
            return float(v - 2**32 if v >= 2**31 else v)
    except Exception:
        return None
    return None

class Path(Exception): pass

CALLMARK = '\x01CF:'   # unresolved CallFunction marker: \x01CF:name\x02

def is_this(o): return isinstance(o, E) and o.s == 'this'

def member(o, n):
    """safe member read"""
    if isinstance(o, E) and o.s == '$SUPER':
        return '$.supg(this, arguments.callee, %s)' % r(n)
    if is_this(o) and isinstance(n, C) and isident(n.v): return 'this.%s' % n.v
    return '$.m(%s, %s)' % (r(o), r(n))

class Tracer:
    def __init__(self, d, depth=0):
        self.d = d; self.depth = depth; self.joinmap = None
        self.locals = set()
        self.budget = [400000]

    def call_obf(self, st, fname, args):
        f = st['funcs'].get(fname)
        if f is None: return None
        start, end, params = f
        sub = {'obf': st['obf'], 'funcs': st['funcs'], 'pool': st['pool'], 'regs': {}, 'regnames': {}, 'tmp': [0]}
        stack = []
        pc = start; steps = 0
        while steps < 100000:
            steps += 1
            if pc >= end or pc >= len(self.d): return C(UNDEF)
            n, a, nxt = decode(self.d, pc)
            if n == 'Return': return stack.pop() if stack else C(UNDEF)
            res = self.step(sub, stack, n, a, [], concrete=True)
            if res is None: pc = nxt
            elif res[0] == 'jump': pc = nxt + res[1]
            elif res[0] == 'if':
                if not isinstance(res[1], C): return None
                pc = nxt + res[2] if tobool(res[1].v) else nxt
            elif res[0] == 'end': return C(UNDEF)
            else: pc = nxt
        return None

    def regname(self, st, rg):
        return st['regnames'].get(rg, 'r%d' % rg)

    def getvar(self, nm):
        if isinstance(nm, C) and isinstance(nm.v, str):
            v = nm.v
            if v == 'this': return E('this')
            if v == 'super': return E('$SUPER')
            if isident(v): return E(v)
            if v in ('arguments',): return E(v)
            parts = v.split('.')
            if '/' not in v and ':' not in v and len(parts) > 1 and all(isident(p) or p in ('this',) for p in parts):
                e = E(parts[0])
                for p in parts[1:]: e = E(member(e, C(p)))
                return e
        return E('$.gv($sc, %s)' % r(nm))

    def target(self, t):
        if isinstance(t, C) and t.v == '': return '$.T($sc)'
        return '$.tgt($sc, %s)' % r(t)

    # ---------- single instruction -------------
    def step(self, st, stack, n, a, out, concrete=False):
        pop = lambda: stack.pop() if stack else C(UNDEF)
        push = stack.append
        def emit(s):
            if concrete or out is None: raise Path('emit in concrete')
            out.append(s)
        if n == 'Push':
            for v in a:
                if isinstance(v, tuple) and v[0] == 'c':
                    if v[1] < len(st['pool']): push(C(st['pool'][v[1]]))
                    else: push(C(UNDEF))
                elif isinstance(v, str) and v.startswith('r') and v[1:].isdigit():
                    rg = int(v[1:])
                    if concrete: push(st['regs'].get(rg, C(UNDEF)))
                    else:
                        nm = self.regname(st, rg)
                        push(E('$SUPER' if nm == 'super' else nm))
                elif v == 'null': push(C(None))
                elif v == 'undefined': push(C(UNDEF))
                elif isinstance(v, str) and v.startswith("'"): push(C(eval(v)))
                elif isinstance(v, str) and v.startswith('BAD'): raise Path('bad push')
                else: push(C(v))
            return None
        if n == 'ConstantPool': st['pool'] = list(a); return None
        if n == 'Pop':
            v = pop()
            if isinstance(v, E) and v.fx:
                s = r(v)
                emit(('(%s);' % s) if s.startswith('function') or s.startswith('{') else s + ';')
            return None
        if n in BIN:
            b = pop(); x = pop()
            # comparing the for-in enumerator itself is the compiler's stack drain after a break: consume keys
            if isinstance(b, E) and b.it: b = E('%s.next()' % b.s, True)
            if isinstance(x, E) and x.it: x = E('%s.next()' % x.s, True)
            if isinstance(b, C) and isinstance(x, C):
                v = fold(n, x.v, b.v)
                if v is not None: push(C(v)); return None
            if n == 'Add': push(E('(Number(%s) + Number(%s))' % (r(x), r(b))))
            elif n in ('StringAdd',): push(E('$.sadd(%s, %s)' % (r(x), r(b))))
            elif n == 'Equals': push(E('$.eq1(%s, %s)' % (r(x), r(b))))
            elif n in ('And', 'Or'): push(E('$.%s(%s, %s)' % (n.lower() + '1', r(x), r(b))))
            else: push(E('(%s %s %s)' % (r(x), BIN[n], r(b))))
            return None
        if n == 'StringAdd':
            b = pop(); x = pop(); push(E('$.sadd(%s, %s)' % (r(x), r(b)))); return None
        if n == 'Not':
            v = pop()
            if isinstance(v, C): push(C(not tobool(v.v))); return None
            if isinstance(v, E) and v.neg is not None: push(v.neg)
            else: push(E('!' + r(v), neg=v))
            return None
        UN = {'ToInteger': '$.int', 'ToNumber': 'Number', 'ToString': 'String', 'TypeOf': '$.typeOf', 'CharToAscii': '$.ord',
              'AsciiToChar': 'String.fromCharCode', 'MBCharToAscii': '$.ord', 'MBAsciiToChar': 'String.fromCharCode',
              'StringLength': '$.slen', 'MBStringLength': '$.slen', 'RandomNumber': '$.random', 'TargetPath': '$.targetPath'}
        if n in UN or n in ('Increment', 'Decrement'):
            v = pop()
            if isinstance(v, C):
                if n == 'Increment' and not isinstance(v.v, (str, Undef)) and v.v is not None: push(C(num(v.v) + 1)); return None
                if n == 'Decrement' and not isinstance(v.v, (str, Undef)) and v.v is not None: push(C(num(v.v) - 1)); return None
                if n == 'ToInteger' and isinstance(v.v, (int, float)) and not isinstance(v.v, bool): push(C(float(int(v.v)))); return None
                if n == 'ToNumber' and isinstance(v.v, (int, float)) and not isinstance(v.v, bool): push(C(float(v.v))); return None
                if n == 'MBStringLength' and isinstance(v.v, str) and concrete: push(C(float(len(v.v)))); return None
            if n == 'Increment': push(E('(Number(%s) + 1)' % r(v)))
            elif n == 'Decrement': push(E('(Number(%s) - 1)' % r(v)))
            elif n == 'RandomNumber': push(E('$.random(%s)' % r(v), True))
            else: push(E('%s(%s)' % (UN[n], r(v))))
            return None
        if n == 'GetTime': push(E('getTimer()')); return None
        if n in ('StringExtract', 'MBStringExtract'):
            c = pop(); i = pop(); s = pop(); push(E('$.substr(%s, %s, %s)' % (r(s), r(i), r(c)))); return None
        if n == 'GetVariable':
            nm = pop()
            if isinstance(nm, C) and is_obf(nm.v):
                push(st['obf'].get(nm.v, C(UNDEF))); return None
            if concrete: raise Path('getvar in concrete')
            push(self.getvar(nm))
            return None
        if n in ('SetVariable', 'DefineLocal'):
            v = pop(); nm = pop()
            if isinstance(nm, C) and is_obf(nm.v):
                st['obf'][nm.v] = v if isinstance(v, C) else C(UNDEF)
                return None
            if isinstance(nm, C) and isident(nm.v):
                if n == 'DefineLocal':
                    if self.depth > 0:
                        self.locals.add(nm.v); emit('var %s = %s;' % (nm.v, r(v)))
                    else:
                        emit('%s = %s;' % (nm.v, r(v)))
                else:
                    emit('%s = %s;' % (nm.v, r(v)))
            else:
                emit('$.sv($sc, %s, %s);' % (r(nm), r(v)))
            return None
        if n == 'DefineLocal2':
            nm = pop()
            if isinstance(nm, C) and is_obf(nm.v): return None
            if isinstance(nm, C) and isident(nm.v) and self.depth > 0:
                self.locals.add(nm.v); emit('var %s;' % nm.v)
            return None
        if n == 'GetMember':
            nm = pop(); o = pop(); push(E(member(o, nm))); return None
        if n == 'SetMember':
            v = pop(); nm = pop(); o = pop()
            if is_this(o) and isinstance(nm, C) and isident(nm.v): emit('this.%s = %s;' % (nm.v, r(v)))
            else: emit('$.sm(%s, %s, %s);' % (r(o), r(nm), r(v)))
            return None
        if n == 'CallFunction':
            nm = pop(); cnt = pop(); k = int(num(cnt.v)) if isinstance(cnt, C) and not math.isnan(num(cnt.v)) else 0
            args = [pop() for _ in range(k)]
            if isinstance(nm, C) and is_obf(nm.v):
                v = self.call_obf(st, nm.v, args)
                if v is None: raise Path('obf call failed')
                push(v); return None
            if concrete: raise Path('call in concrete')
            if isinstance(nm, C) and nm.v == 'super':
                push(E('$.supc(this, arguments.callee, [%s])' % ', '.join(map(r, args)), True)); return None
            if isinstance(nm, C) and isident(nm.v):
                push(E('\x01$.cf($sc, "%s", [%s])' % (nm.v, ', '.join(map(r, args))), True)); return None
            push(E('$.cf($sc, %s, [%s])' % (r(nm), ', '.join(map(r, args))), True)); return None
        if n == 'CallMethod':
            nm = pop(); o = pop(); cnt = pop(); k = int(num(cnt.v)) if isinstance(cnt, C) and not math.isnan(num(cnt.v)) else 0
            args = [pop() for _ in range(k)]
            if concrete: raise Path('call in concrete')
            al = ', '.join(map(r, args))
            empty = isinstance(nm, C) and (nm.v is None or isinstance(nm.v, Undef) or nm.v == '')
            if isinstance(o, E) and o.s == '$SUPER':
                if empty: push(E('$.supc(this, arguments.callee, [%s])' % al, True))
                else: push(E('$.supm(this, arguments.callee, %s, [%s])' % (r(nm), al), True))
            elif empty:
                push(E('$.call(%s, [%s])' % (r(o), al), True))
            else:
                push(E('$.cm(%s, %s, [%s])' % (r(o), r(nm), al), True))
            return None
        if n in ('NewObject', 'NewMethod'):
            nm = pop()
            o = pop() if n == 'NewMethod' else None
            cnt = pop(); k = int(num(cnt.v)) if isinstance(cnt, C) and not math.isnan(num(cnt.v)) else 0
            args = [pop() for _ in range(k)]
            if concrete: raise Path('new in concrete')
            al = ', '.join(map(r, args))
            if n == 'NewObject':
                if isinstance(nm, C) and nm.v == 'Array' and k != 1: push(E('[%s]' % al, True)); return None
                if isinstance(nm, C) and nm.v == 'Object' and k == 0: push(E('{}', True)); return None
                ctor = r(self.getvar(nm)) if isinstance(nm, C) else '$.gv($sc, %s)' % r(nm)
            else:
                empty = isinstance(nm, C) and (nm.v is None or isinstance(nm.v, Undef) or nm.v == '')
                ctor = r(o) if empty else member(o, nm)
            push(E('$.nw(%s, [%s])' % (ctor, al), True)); return None
        if n == 'InitArray':
            cnt = pop(); k = int(num(cnt.v)) if isinstance(cnt, C) else 0
            if concrete: raise Path('arr in concrete')
            push(E('[%s]' % ', '.join(r(pop()) for _ in range(k)))); return None
        if n == 'InitObject':
            cnt = pop(); k = int(num(cnt.v)) if isinstance(cnt, C) else 0
            if concrete: raise Path('obj in concrete')
            items = []
            for _ in range(k):
                v = pop(); nm = pop()
                key = jsstr(nm.v) if isinstance(nm, C) and isinstance(nm.v, str) else ('[%s]' % r(nm))
                items.append('%s: %s' % (key, r(v)))
            push(E('{%s}' % ', '.join(items))); return None
        if n == 'Delete':
            nm = pop(); o = pop(); push(E('$.del(%s, %s)' % (r(o), r(nm)), True)); return None
        if n == 'Delete2':
            nm = pop(); push(E('$.del2($sc, %s)' % r(nm), True)); return None
        if n == 'PushDuplicate':
            v = stack[-1] if stack else C(UNDEF)
            if isinstance(v, E) and (v.fx or len(v.s) > 60) and not v.it:
                t = self.newtmp(st); emit('%s = %s;' % (t, r(v))); stack[-1] = E(t); v = stack[-1]
            push(v); return None
        if n == 'StackSwap':
            if len(stack) >= 2: stack[-1], stack[-2] = stack[-2], stack[-1]
            return None
        if n == 'StoreRegister':
            v = stack[-1] if stack else C(UNDEF)
            rg = a[0]
            if concrete:
                st['regs'][rg] = v; return None
            if out is None: raise Path('spec store')
            rn = self.regname(st, rg)
            if isinstance(v, E) and v.it:
                emit('%s = %s.next();' % (rn, v.s))
                stack[-1] = E(rn)
                stack.insert(len(stack) - 1, v)
                return None
            emit('%s = %s;' % (rn, r(v)))
            if not isinstance(v, C): stack[-1] = E(rn)
            return None
        if n == 'GetProperty':
            i = pop(); t = pop()
            if concrete: raise Path('prop in concrete')
            if isinstance(i, C) and isinstance(i.v, (int, float)) and 0 <= num(i.v) < len(PROPS):
                push(E('$.m(%s, "%s")' % (self.target(t), PROPS[int(num(i.v))])))
            else: push(E('$.getProp(%s, %s)' % (self.target(t), r(i))))
            return None
        if n == 'SetProperty':
            v = pop(); i = pop(); t = pop()
            if isinstance(i, C) and isinstance(i.v, (int, float)) and 0 <= num(i.v) < len(PROPS):
                emit('$.sm(%s, "%s", %s);' % (self.target(t), PROPS[int(num(i.v))], r(v)))
            else: emit('$.setProp(%s, %s, %s);' % (self.target(t), r(i), r(v)))
            return None
        if n in ('Play', 'Stop', 'NextFrame', 'PrevFrame'):
            emit('$.T($sc).%s();' % (n[0].lower() + n[1:])); return None
        if n in ('StopSounds', 'ToggleQuality', 'EndDrag'):
            emit('$.%s();' % (n[0].lower() + n[1:])); return None
        if n == 'Trace': emit('$.trace(%s);' % r(pop())); return None
        if n == 'GotoFrame': emit('$.T($sc).gotoAndStop(%d);' % (a[0] + 1)); return None
        if n == 'GoToLabel': emit('$.T($sc).gotoAndStop(%s);' % lit(a[0])); return None
        if n == 'GotoFrame2':
            f = pop(); emit('$.T($sc).%s(%s);' % ('gotoAndPlay' if a[0] & 1 else 'gotoAndStop', r(f))); return None
        if n == 'SetTarget': emit('$.tell($sc, %s);' % lit(a[0])); return None
        if n == 'SetTarget2': emit('$.tell($sc, %s);' % r(pop())); return None
        if n == 'GetURL': emit('$.getURL(%s, %s);' % (lit(a[0]), lit(a[1]))); return None
        if n == 'GetURL2':
            t = pop(); u = pop(); emit('$.getURL(%s, %s);' % (r(u), r(t))); return None
        if n == 'RemoveSprite': emit('$.rm($sc, %s);' % r(pop())); return None
        if n == 'CloneSprite':
            dp = pop(); t = pop(); s = pop(); emit('$.dup($sc, %s, %s, %s);' % (r(s), r(t), r(dp))); return None
        if n == 'StartDrag':
            t = pop(); lock = pop(); c = pop()
            if isinstance(c, C) and tobool(c.v):
                pop(); pop(); pop(); pop()
            emit('$.startDrag($sc, %s, %s);' % (r(t), r(lock))); return None
        if n == 'Throw': emit('throw %s;' % r(pop())); return ('end',)
        if n == 'CastOp':
            o = pop(); c = pop(); push(E('$.cast(%s, %s)' % (r(c), r(o)))); return None
        if n == 'ImplementsOp':
            c = pop(); cnt = pop(); k = int(num(cnt.v)) if isinstance(cnt, C) else 0
            for _ in range(k): pop()
            return None
        if n == 'Extends':
            sup = pop(); sub = pop(); emit('$.ext(%s, %s);' % (r(sub), r(sup))); return None
        if n in ('Enumerate', 'Enumerate2'):
            o = pop()
            if out is None or concrete: raise Path('enum in spec')
            t = self.newtmp(st)
            emit('%s = $.forin(%s);' % (t, r(self.getvar(o)) if n == 'Enumerate' else r(o)))
            push(E(t, it=True)); return None
        if n == 'Jump': return ('jump', a[0])
        if n == 'If': return ('if', pop(), a[0])
        if n == 'Return':
            emit('return %s;' % r(pop()) if stack else 'return;'); return ('end',)
        if n == 'End': return ('end',)
        if n == 'Call': emit('$.callFrame($sc, %s);' % r(pop())); return None
        raise Path('unhandled ' + n)

    def newtmp(self, st):
        st['tmp'][0] += 1
        return '$t%d' % st['tmp'][0]

    def keyof(self, pc, st):
        return (pc, tuple(sorted((k, repr(v.v) if isinstance(v, C) else '?') for k, v in st['obf'].items())))

    @staticmethod
    def cl(st):
        return {'obf': dict(st['obf']), 'funcs': st['funcs'], 'pool': list(st['pool']), 'regs': dict(st['regs']), 'regnames': st.get('regnames', {}), 'tmp': st['tmp']}

    def run(self, st, stack, pc, end, stopkey=None, collect=None, lvl=0, maxsteps=4000):
        bud = self.budget
        for _ in range(maxsteps):
            bud[0] -= 1
            if bud[0] < 0: return None
            if pc < 0 or pc >= len(self.d) or pc >= end: return None
            k = self.keyof(pc, st)
            if collect is not None:
                if k in collect: return None
                collect[k] = len(stack)
            if stopkey is not None and k == stopkey: return (pc, st, stack)
            if self.joinmap is not None and k in self.joinmap and self.joinmap[k] == len(stack) and lvl == 0:
                return (pc, st, stack)
            n, a, nxt = decode(self.d, pc)
            if n in ('DefineFunction', 'DefineFunction2', 'With', 'Try', 'Return', 'End', 'Throw'): return None
            try:
                res = self.step(st, stack, n, a, None)
            except Path:
                return None
            if res is None: pc = nxt; continue
            if res[0] == 'jump': pc = nxt + res[1]; continue
            if res[0] == 'if':
                c = res[1]
                if isinstance(c, C): pc = nxt + res[2] if tobool(c.v) else nxt; continue
                if lvl > 6: return None
                saved = self.joinmap
                self.joinmap = None
                rr = self.resolve_if(st, stack, c, nxt, nxt + res[2], end, lvl + 1)
                self.joinmap = saved
                if rr is None: return None
                st, stack, pc = rr; continue
            return None
        return None

    def resolve_if(self, st, stack, c, nf, nt, end, lvl=0):
        saved = self.joinmap
        try:
            depth = len(stack)
            self.joinmap = None
            tmap = {}
            self.run(self.cl(st), list(stack), nt, end, collect=tmap, lvl=lvl)
            self.joinmap = tmap
            rf = self.run(self.cl(st), list(stack), nf, end, lvl=0)
            self.joinmap = None
            if rf is None: return None
            pcj, stf, stackf = rf
            kj = self.keyof(pcj, stf)
            rt = self.run(self.cl(st), list(stack), nt, end, stopkey=kj, lvl=lvl)
            if rt is None: return None
            _, stt, stackt = rt
        finally:
            self.joinmap = saved
        if len(stackt) != len(stackf): return None
        n = len(stackf)
        if n == depth and all(x is y for x, y in zip(stackt, stackf)):
            return (stf, stackf, pcj)
        if n not in (depth, depth + 1) or n == 0: return None
        if any(x is not y for x, y in zip(stackt[:n - 1], stackf[:n - 1])): return None
        tv = stackt[-1]; fv = stackf[-1]
        if n == depth and stack[-1] is tv and c is tv:
            v = E('(%s || %s)' % (r(tv), r(fv)))
        elif n == depth and stack[-1] is tv and isinstance(c, E) and c.neg is tv:
            v = E('(%s && %s)' % (r(tv), r(fv)))
        elif n == depth + 1:
            v = E('(%s ? %s : %s)' % (r(c), r(tv), r(fv)))
        else:
            return None
        return (stf, stackf[:-1] + [v], pcj)

    def funcdef(self, st, n, a, nxt, out, stack):
        if n == 'DefineFunction':
            name, params, size = a; regnames = {}
            plist = list(params)
        else:
            name, rc, flags, params2, size = a
            regnames = {}
            plist = []
            for i, (rg, p) in enumerate(params2):
                pn = p if isident(p) else '$p%d' % i
                plist.append(pn)
                if rg: regnames[rg] = pn
            k = 1
            for bit, nm in ((0x01, 'this'), (0x04, 'arguments'), (0x10, 'super'), (0x40, '_root'), (0x80, '_parent'), (0x100, '_global')):
                if flags & bit:
                    regnames[k] = nm; k += 1
        body_start = nxt; body_end = nxt + size
        if is_obf(name):
            st['funcs'][name] = (body_start, body_end, plist)
            return body_end
        prologue = []
        for attempt in range(3):
            sub = Tracer(self.d, self.depth + 1)
            sub.locals = set(p for p in plist if isident(p))
            try:
                code = sub.trace(body_start, body_end, list(st['pool']), regnames, dict(st['funcs']))
            except Exception as ex:
                code = ['/* decompile failed: %s */' % ex]
            body = '\n'.join(code)
            bad = set(re.findall(r'(?m)^\s*(this|_root|_parent|_global|arguments|\$SUPER) = ', strip_fn(body)))
            if not bad: break
            for rg, nm in list(regnames.items()):
                if nm in bad or (nm == 'super' and '$SUPER' in bad):
                    del regnames[rg]
                    prologue.append('r%d = %s;' % (rg, {'super': 'undefined'}.get(nm, nm)))
        if prologue: body = '\n'.join(prologue) + '\n' + body
        # resolve call markers for names local to this function
        body = resolve_calls(body, sub.locals)
        decl = sorted(set(re.findall(r'(?<![\w$.])(\$[st]\d+|r\d+)(?=\s*=[^=])', strip_nested(body))) - set(plist) - set(regnames.values()))
        if decl: body = 'var %s;\n%s' % (', '.join(decl), body)
        ind = '    '
        fname = name if isident(name) else ''
        txt = 'function %s(%s) {\n%s\n}' % (fname, ', '.join(p if isident(p) else '$p%d' % i for i, p in enumerate(plist)), '\n'.join(ind + l for l in body.split('\n')))
        if name:
            if self.depth > 0 and isident(name):
                self.locals.add(name)
                out.append('var %s = %s;' % (name, txt))
            elif isident(name):
                out.append('%s = %s;' % (name, txt))
            else:
                out.append('$.sv($sc, %s, %s);' % (jsstr(name), txt))
        else:
            stack.append(E(txt))
        return body_end

    def trace(self, start, end, pool=None, regnames=None, funcs=None, obf=None):
        blocks = {}
        order = []
        work = []
        tmpc = [0]
        def mkst():
            return {'obf': dict(obf or {}), 'funcs': dict(funcs or {}), 'pool': list(pool or []), 'regs': {}, 'regnames': dict(regnames or {}), 'tmp': tmpc}
        def clone(st):
            return {'obf': dict(st['obf']), 'funcs': dict(st['funcs']), 'pool': list(st['pool']), 'regs': {}, 'regnames': st['regnames'], 'tmp': tmpc}
        def goto(pc, st, stack, out):
            ent = []
            for i, v in enumerate(stack):
                if isinstance(v, E) and v.it:
                    ent.append(v); continue
                if not (isinstance(v, E) and v.s == '$s%d' % i):
                    out.append('$s%d = %s;' % (i, r(v)))
                ent.append(E('$s%d' % i))
            k = self.keyof(pc, st)
            if k not in blocks:
                lbl = 'L%d' % (len(blocks) + 1)
                blocks[k] = [lbl, None, 0]
                work.append((k, pc, clone(st), ent))
            blocks[k][2] += 1
            return blocks[k][0]
        st0 = mkst()
        k0 = self.keyof(start, st0)
        blocks[k0] = ['L0', None, 1]
        work.append((k0, start, st0, []))
        total = 0
        while work:
            k, pc, st, ent = work.pop(0)
            order.append(k)
            out = []
            stack = list(ent)
            steps = 0
            while True:
                steps += 1; total += 1
                if steps > 200000 or total > 2000000:
                    out.append('/* step limit */ return;'); break
                if pc < 0 or pc >= len(self.d):
                    out.append('/* pc out of range */ return;'); break
                if pc >= end: out.append('return;'); break
                try:
                    n, a, nxt = decode(self.d, pc)
                except Exception:
                    out.append('/* decode error at %d */ return;' % pc); break
                if n in ('DefineFunction', 'DefineFunction2'):
                    pc = self.funcdef(st, n, a, nxt, out, stack); continue
                if n == 'With':
                    o = stack.pop() if stack else C(UNDEF)
                    out.append('/* with(%s) not supported */' % r(o)); pc = nxt; continue
                if n == 'Try':
                    out.append('/* try not supported */'); pc = nxt; continue
                try:
                    res = self.step(st, stack, n, a, out)
                except Path as ex:
                    out.append('/* %s at %d */ return;' % (ex, pc)); break
                if res is None: pc = nxt; continue
                if res[0] == 'end':
                    if n == 'End': out.append('return;')
                    break
                if res[0] == 'jump': pc = nxt + res[1]; continue
                if res[0] == 'if':
                    c = res[1]
                    if isinstance(c, C):
                        pc = nxt + res[2] if tobool(c.v) else nxt; continue
                    rr = self.resolve_if(st, stack, c, nxt, nxt + res[2], end)
                    if rr is not None:
                        st, stack, pc = rr
                        st['tmp'] = tmpc
                        continue
                    lt = goto(nxt + res[2], st, stack, out)
                    lf = goto(nxt, st, stack, out)
                    out.append('\x03if (%s) goto %s; else goto %s;' % (r(c), lt, lf))
                    break
                pc = nxt
            blocks[k][1] = out
        return self.structure(blocks, order)

    def structure(self, blocks, order):
        bylabel = {b[0]: b for b in blocks.values()}
        refs = {b[0]: b[2] for b in blocks.values()}
        IFRE = re.compile(r'^\x03if \((.*)\) goto (L\d+); else goto (L\d+);$', re.S)
        def render(lbl, seen):
            res = []
            for ln in bylabel[lbl][1] or []:
                m = IFRE.match(ln)
                if m:
                    cond, lt, lf = m.groups()
                    tb = sub(lt, seen); fb = sub(lf, seen)
                    res.append('if (%s) {' % cond)
                    res += ['    ' + x for x in '\n'.join(tb).split('\n')]
                    res.append('} else {')
                    res += ['    ' + x for x in '\n'.join(fb).split('\n')]
                    res.append('}')
                else:
                    res.append(ln)
            return res
        def sub(lbl, seen):
            if refs[lbl] == 1 and lbl not in seen:
                seen.add(lbl)
                return render(lbl, seen)
            return ['goto %s;' % lbl]
        seen = {'L0'}
        sections = [('L0', render('L0', seen))]
        for k in order:
            lbl = blocks[k][0]
            if lbl not in seen:
                seen.add(lbl)
                sections.append((lbl, render(lbl, seen)))
        # drop dead slot stores (slot never read)
        alltxt = '\n'.join('\n'.join(s) for _, s in sections)
        reads = {}
        for m in re.finditer(r'\$s\d+', alltxt): reads[m.group(0)] = reads.get(m.group(0), 0) + 1
        stores = {}
        for m in re.finditer(r'(?m)^\s*(\$s\d+) = ', alltxt): stores[m.group(1)] = stores.get(m.group(1), 0) + 1
        dead = {s for s in stores if reads.get(s, 0) <= stores[s]}
        def clean(lines):
            o = []
            for ln in lines:
                m = re.match(r'^\s*(\$s\d+) = (.*);$', ln)
                if m and m.group(1) in dead:
                    rhs = m.group(2)
                    if re.match(r'^[\w$."\- ()!]*$', rhs) and '(' not in rhs.replace('(-', ''):
                        continue
                o.append(ln)
            return o
        sections = [(l, clean(s)) for l, s in sections]
        if len(sections) == 1:
            out = sections[0][1]
            out = [re.sub(r'goto (L\d+);', r'/*goto \1*/', l) for l in out]
            return out
        # goto program -> labelled switch loop
        out = ['var $L = 0;', '$loop: for (;;) {', 'switch ($L) {']
        for lbl, lines in sections:
            out.append('case %s:' % lbl[1:])
            for l in lines:
                out.append('    ' + re.sub(r'goto L(\d+);', r'{ $L = \1; continue $loop; }', l))
            out.append('    return;')
        out += ['}', '}']
        return out

def strip_fn(body):
    # drop nested function literal bodies (lines indented deeper than a 'function' opener)
    out = []; skip = None
    for ln in body.split('\n'):
        ind = len(ln) - len(ln.lstrip())
        if skip is not None:
            if ind > skip or ln.strip() == '': continue
            skip = None
        out.append(ln)
        if re.search(r'function [\w$]*\([^)]*\) \{$', ln): skip = ind
    return '\n'.join(out)

def strip_nested(body):
    # crude: remove nested function bodies so declarations are collected per function
    outl = []; depth = 0
    for ln in body.split('\n'):
        if depth == 0: outl.append(ln)
        depth += ln.count('function (') + ln.count('function ') - ln.count('function (') if False else 0
    return '\n'.join(outl)

CALLRE = re.compile('\x01\\$\\.cf\\(\\$sc, "([A-Za-z_$][A-Za-z0-9_$]*)", \\[')
def resolve_calls(body, local):
    return CALLRE.sub(lambda m: '$.lc(%s, [' % m.group(1) if m.group(1) in local else m.group(0), body)
def finalize_calls(body):
    return body.replace('\x01', '')
