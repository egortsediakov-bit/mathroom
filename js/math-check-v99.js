/* Mathroom v99 — conservative deterministic arithmetic and linear-equation checks.
   No eval, network or AI. Unsupported tasks MUST remain teacher-reviewed. */
(()=>{
  'use strict';
  const API={};
  const close=(a,b)=>Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));
  const normal=s=>String(s??'').trim().replace(/[−–—]/g,'-')
    .replace(/[×·⋅]/g,'*').replace(/[÷:]/g,'/')
    .replace(/²/g,'^2').replace(/³/g,'^3').replace(/(\d),(\d)/g,'$1.$2')
    .replace(/\u00a0/g,' ');
  const tokenize=input=>{
    const raw=normal(input).replace(/\s+/g,'');
    if(!raw||raw.length>180||/[^0-9.x()+\-*/^]/.test(raw))throw new Error('UNSUPPORTED');
    const tokens=raw.match(/\d+(?:\.\d+)?|x|[()+\-*/^]/g)||[];
    if(tokens.join('')!==raw||tokens.length>100)throw new Error('UNSUPPORTED');
    const out=[];
    for(const token of tokens){
      const previous=out[out.length-1];
      const prevEnd=previous==='x'||previous===')'||(/^\d/.test(previous||''));
      const nextStart=token==='x'||token==='(';
      if(prevEnd&&nextStart)out.push('*');
      out.push(token);
    }
    return out;
  };
  const solveExpression=(input,variable=false)=>{
    const t=tokenize(input);let pos=0,depth=0;
    const make=(a,b)=>({a,b});
    const add=(p,q)=>make(p.a+q.a,p.b+q.b);
    const neg=p=>make(-p.a,-p.b);
    const sub=(p,q)=>add(p,neg(q));
    const mul=(p,q)=>{
      if(Math.abs(p.a)>1e-12&&Math.abs(q.a)>1e-12)throw new Error('NONLINEAR');
      return make(p.a*q.b+q.a*p.b,p.b*q.b);
    };
    const div=(p,q)=>{
      if(Math.abs(q.a)>1e-12||Math.abs(q.b)<1e-12)throw new Error('NONLINEAR');
      return make(p.a/q.b,p.b/q.b);
    };
    const power=(p,q)=>{
      if(Math.abs(q.a)>1e-12||!Number.isInteger(q.b)||Math.abs(q.b)>8)throw new Error('UNSUPPORTED');
      if(Math.abs(p.a)>1e-12&&q.b!==1&&q.b!==0)throw new Error('NONLINEAR');
      if(q.b===0)return make(0,1);
      if(q.b===1)return p;
      return make(0,p.b**q.b);
    };
    const primary=()=>{
      if(++depth>50)throw new Error('UNSUPPORTED');
      const token=t[pos++];
      let value;
      if(token==='('){
        value=addition();
        if(t[pos++]!==')')throw new Error('UNSUPPORTED');
      }else if(token==='x'){
        if(!variable)throw new Error('UNSUPPORTED');
        value=make(1,0);
      }else if(token&&/^\d/.test(token)){
        value=make(0,Number(token));
      }else throw new Error('UNSUPPORTED');
      depth--;
      return value;
    };
    const exponent=()=>{
      let left=primary();
      if(t[pos]==='^'){pos++;left=power(left,unary())}
      return left;
    };
    const unary=()=>{
      if(t[pos]==='+'){pos++;return unary()}
      if(t[pos]==='-'){pos++;return neg(unary())}
      return exponent();
    };
    const product=()=>{
      let left=unary();
      while(t[pos]==='*'||t[pos]==='/'){
        const op=t[pos++],right=unary();
        left=op==='*'?mul(left,right):div(left,right);
      }
      return left;
    };
    const addition=()=>{
      let left=product();
      while(t[pos]==='+'||t[pos]==='-'){
        const op=t[pos++],right=product();
        left=op==='+'?add(left,right):sub(left,right);
      }
      return left;
    };
    const result=addition();
    if(pos!==t.length||!Number.isFinite(result.a)||!Number.isFinite(result.b)
      ||Math.abs(result.a)>1e10||Math.abs(result.b)>1e10)throw new Error('UNSUPPORTED');
    return result;
  };
  const cleanBody=s=>s.replace(/\s*[.?!。]\s*$/,'').trim();
  const infer=content=>{
    const s=String(content??'').trim();
    if(s.length>350||!s||/\n/.test(s)||/\b(?:рисунк|таблиц|график|чертеж|чертёж|схем|см\.|площад|корн)/i.test(s))
      return null;
    const eq=s.match(/^(?:решите\s+(?:линейное\s+)?уравнение|найдите\s+корень\s+уравнения)\s*[:—]?\s*(.+)$/iu);
    if(eq){
      const body=cleanBody(eq[1]),pieces=body.split('=');
      if(pieces.length!==2)return null;
      try{
        const l=solveExpression(pieces[0],true),r=solveExpression(pieces[1],true);
        const a=l.a-r.a,b=r.b-l.b;
        if(Math.abs(a)<1e-10)return null; // zero or infinitely many roots
        const x=b/a;
        if(!Number.isFinite(x)||Math.abs(x)>1e10)return null;
        return {kind:'linear-equation',value:x};
      }catch{return null}
    }
    const arithmetic=s.match(/^(?:вычислите(?:\s+значение)?(?:\s+выражения)?|найдите\s+значение(?:\s+выражения)?|чему\s+равно)\s*[:—]?\s*(.+)$/iu);
    if(!arithmetic)return null;
    try{
      const v=solveExpression(cleanBody(arithmetic[1]),false);
      return {kind:'arithmetic',value:v.b};
    }catch{return null}
  };
  const answerValue=answer=>{
    const s=String(answer??'').trim().replace(/^(?:ответ\s*[:—-]?\s*|x\s*=\s*)/i,'');
    if(!s||/[;|]/.test(s))return null;
    try{
      const x=solveExpression(s,false);
      return x.b;
    }catch{return null}
  };
  const display=x=>{
    if(close(x,Math.round(x)))return String(Math.round(x));
    return String(Number(x.toPrecision(10))).replace('.',',');
  };
  API.check=({content='',answer='',hasVisual=false}={})=>{
    if(hasVisual)return {status:'unsupported',reason:'Условие содержит изображения или чертежи'};
    const found=infer(content);
    if(!found)return {status:'unsupported',reason:'Проверка этого типа задачи пока недоступна'};
    const expected=display(found.value),supplied=answerValue(answer);
    const basis={kind:found.kind,expected,numeric_expected:found.value,engine:'mathroom-local-v99'};
    if(!String(answer??'').trim())return {...basis,status:'missing',
      message:'Вычисленный ответ: '+expected+'. Сверь с оригиналом и добавь в поле ответа.'};
    if(supplied===null)return {...basis,status:'unsupported',
      reason:'Ответ нельзя однозначно прочитать как одно число; проверь вручную'};
    const ok=close(supplied,found.value);
    return {...basis,status:ok?'match':'mismatch',numeric_given:supplied,
      message:ok?'Ответ совпадает с локальным расчётом. Проверь исходное условие по PDF.':
      'Ответ не совпадает: указано '+String(answer).trim()+', локальный расчёт даёт '+expected+'. Проверь условие и ответ.'};
  };
  API.calculate=expression=>solveExpression(expression,false).b;
  window.MathroomMathCheckV99=API;
})();
