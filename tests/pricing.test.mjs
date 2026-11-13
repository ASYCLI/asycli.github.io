import { estimate, membership, DEFAULT_PRICING as P, depositFor, travelFee } from "../supabase/functions/_shared/pricing.js";
import assert from "node:assert";
let fails = [], raised = [], n = 0;
const chk = (e, tag) => { n++; if (e.review && !e.reasons.every(r=>/Outside|custom/.test(r))) fails.push([tag, e.total, e.internal?.marginPercent]); if (e.internal && e.internal.marginPercent < 24.9) fails.push(["LOWMARGIN",tag,e.internal.marginPercent]); if (e.internal?.raisedToFloorBy) raised.push([tag,e.subtotal,e.internal.raisedToFloorBy]); };
for (const service of ["fall","spring"]) for (const tier of ["small","medium","large"]) for (const v of Object.keys(service==="fall"?P.fall.leafVolume:P.spring.debris)) for (const areas of ["front","back","both"]) for (const access of ["easy","moderate","difficult"]) for (const disposal of ["bag","haul"]) for (const trees of ["0-2","3-5","6-10","11+"]) for (const dm of [10,35,50]) {
  const e = estimate({service,tier,leafVolume:v,debris:v,areas,access,disposal,trees,driveMinutes:dm,extras:[]}); chk(e,`${service} ${tier} ${v} ${areas} ${access} ${disposal} ${trees} ${dm}m`);
}
for (const sq of [1500,3999,5000,9000,13000,20000]) for (const c of ["maintained","overgrown","very_overgrown"]) for (const o of ["few","some","many"]) for (const t of ["light","standard","heavy"]) for (const dm of [10,35,50]) chk(estimate({service:"summer",lawnSqft:sq,condition:c,obstacles:o,trimming:t,driveMinutes:dm}),`summer ${sq} ${c} ${o} ${t} ${dm}`);
for (const tier of ["small","medium","large"]) for (const w of ["none","short","long"]) for (const d of ["2-6","6-12","12+"]) for (const ice of ["none","some","heavy"]) for (const salting of [true,false]) for (const dm of [10,35,50]) chk(estimate({service:"winter",tier,walkway:w,depth:d,ice,salting,driveMinutes:dm}),`winter ${tier} ${w} ${d} ${ice} ${salting} ${dm}`);
console.log("combos", n, "fails", fails.length, "raised", raised.length); console.log(fails.slice(0,10)); const bySvc={}; for(const r of raised){const k=r[0].split(" ").slice(0,2).join(" "); bySvc[k]=(bySvc[k]||0)+1}; console.log(bySvc); console.log(raised.filter(r=>r[2]>30).slice(0,15));
for (const s of ["spring","summer","fall","winter"]) for (const t of ["small","medium","large"]) { const m = membership(s,t); console.log(s,t,m.monthly,m.internal); }
// spot checks
const f = estimate({service:"fall",tier:"medium",leafVolume:"normal",areas:"both",access:"easy",disposal:"haul",trees:"3-5",driveMinutes:35,extras:[]});
console.log(JSON.stringify(f.lines), f.total, f.deposit, f.internal.marginPercent);
assert.equal(travelFee(20,P).fee,0); assert.equal(travelFee(30,P).fee,25); assert.ok(travelFee(80,P).review);
assert.deepEqual(depositFor(120,P),{dueNow:120,balance:0,fullPrepay:true});
const ov = estimate({service:"fall",tier:"medium",leafVolume:"normal",areas:"both",disposal:"bag",driveMinutes:35,travelOverride:0});
assert.ok(!ov.lines.some(l=>l.label.startsWith("Travel")), "override removes travel");
const ov2 = estimate({service:"fall",tier:"medium",leafVolume:"normal",areas:"both",disposal:"bag",driveMinutes:35,travelOverride:10});
assert.equal(ov2.lines.filter(l=>l.label.startsWith("Travel")).length,1,"single travel line");
console.log("asserts ok");
