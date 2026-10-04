import {
  store,
  adjustAirframeCycles, correctLifeHistory, applyReplacement,
  saveLifeDraft, discardLifeDraft, recordLifeConflict,
  signStage, releasePackage, partRemaining, partSegmentUsed, LIFE_MIN_REMAINING
} from '../src/store';
import type { ReplacementResult, LifeConflict } from '../src/api';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name); }
};
const findPart = (id: string) => store.getState().maintenance.lifeParts.find((p) => p.id === id)!;
const findSig = (stage: string) => store.getState().maintenance.signatures.find((s) => s.stage === stage)!;

// 初始账
const s0 = store.getState().maintenance;
ok('初始机身循环 24318', s0.airframeCycles === 24318);
const bar0 = findPart('LLP-NLG-03');
ok('减摆器装机且初始剩余 862', bar0.status === '装机' && partRemaining(bar0, s0.airframeCycles) === 862);
const act0 = findPart('LLP-NLG-04');
ok('转弯作动筒已拆，固化消耗 2000', act0.status === '已拆' && act0.frozenConsumed === 2000);

// 规则：循环变化只重算装机件；已拆件原值保留
store.dispatch(adjustAirframeCycles({ delta: 100, actor: '测试', reason: '测试入账' }));
const s1 = store.getState().maintenance;
ok('循环账更新 24418', s1.airframeCycles === 24418);
ok('装机件剩余随循环减 100（862->762）', partRemaining(findPart('LLP-NLG-03'), 24418) === 762);
ok('已拆件 frozenConsumed 仍为 2000', findPart('LLP-NLG-04').frozenConsumed === 2000);
ok('循环变化后适航/放行已签失效：适航初始待签署，先签再验', findSig('适航').status === '待签署');
store.dispatch(signStage('适航'));
store.dispatch(signStage('放行'));
ok('签署成功', findSig('适航').status === '已签署' && findSig('放行').status === '已签署');
store.dispatch(adjustAirframeCycles({ delta: 50, actor: '测试', reason: '再次入账' }));
ok('循环再变化使依赖签字失效', findSig('适航').status === '已失效' && findSig('放行').status === '已失效');
ok('非寿命依赖的机械签字不受影响', findSig('机械').status === '已签署');
ok('失效带原因', /机身循环/.test(findSig('适航').invalidReason ?? ''));

// 规则：履历修正只重算该装机件并失效签字
store.dispatch(correctLifeHistory({ partId: 'LLP-NLG-03', startingUsed: 8000, actor: '测试' }));
ok('履历修正后重算剩余', partRemaining(findPart('LLP-NLG-03'), store.getState().maintenance.airframeCycles) === 10400 - 8000 - (24468 - 22980));

// 规则：装机冻结 / 拆下固化（applyReplacement）
const cycleAtReplace = store.getState().maintenance.airframeCycles;
const expectedConsumed = cycleAtReplace - bar0.installedAtCycle!;
const result: ReplacementResult = {
  accepted: true,
  revision: store.getState().maintenance.lifeRevision + 1,
  event: {
    eventId: 'EV-TEST-0001',
    removedPartId: 'LLP-NLG-03',
    consumed: expectedConsumed,
    newPart: {
      id: 'LLP-NLG-09', pn: 'NLG-BAR-4410R', sn: 'SN-TEST-1', name: '前起减摆器', position: '前起落架 / 减摆器',
      lifeLimit: 12000, startingUsed: 0, status: '装机', installedAtCycle: cycleAtReplace,
      events: [{ eventId: 'EV-TEST-0001', kind: '装机', cardId: 'CARD-09', actor: '测试', airframeCycles: cycleAtReplace, time: '10:00' }]
    },
    airframeCycles: cycleAtReplace,
    time: '10:00'
  }
};
store.dispatch(applyReplacement({ result, cardId: 'CARD-09', actor: '测试' }));
const s2 = store.getState().maintenance;
const oldBar = findPart('LLP-NLG-03');
ok('旧件已拆并固化消耗', oldBar.status === '已拆' && oldBar.frozenConsumed === expectedConsumed && oldBar.removedAtCycle === cycleAtReplace);
const newBar = findPart('LLP-NLG-09');
ok('新件装机并冻结循环', newBar.status === '装机' && newBar.installedAtCycle === cycleAtReplace);
ok('新件起始剩余 = 寿限', partRemaining(newBar, cycleAtReplace) === 12000);

// 拆换后循环再涨：新件重算，旧件不动
store.dispatch(adjustAirframeCycles({ delta: 300, actor: '测试', reason: '拆换后入账' }));
const s3 = store.getState().maintenance;
ok('新件随循环消耗 300', partSegmentUsed(findPart('LLP-NLG-09'), s3.airframeCycles) === 300);
ok('旧件固化值不变', findPart('LLP-NLG-03').frozenConsumed === expectedConsumed);

// 幂等：同事件号 applyReplacement 不重复入账
const beforeCount = s3.lifeParts.length;
store.dispatch(applyReplacement({ result, cardId: 'CARD-09', actor: '测试' }));
ok('同事件号重复应用不新增件、不重复固化', store.getState().maintenance.lifeParts.length === beforeCount
  && findPart('LLP-NLG-03').frozenConsumed === expectedConsumed);

// 规则：写入失败保留草稿
const draft = {
  eventId: 'EV-TEST-0002', cardId: 'CARD-09', removedPartId: 'LLP-NLG-01',
  position: '前起落架 / 支柱', newPartNumber: 'X', newSerial: 'Y', newLifeLimit: 30000,
  airframeCycles: s3.airframeCycles, actor: '测试', expectedRevision: s3.lifeRevision
};
store.dispatch(saveLifeDraft({ draft: { ...draft, reason: '写入失败', savedAt: 't', attempts: 1 } }));
ok('失败后保留草稿（原事件号）', store.getState().maintenance.lifeDrafts.some((d) => d.eventId === 'EV-TEST-0002'));
// 同事件号再失败：草稿不重复
store.dispatch(saveLifeDraft({ draft: { ...draft, reason: '写入失败', savedAt: 't2', attempts: 2 } }));
ok('同事件号失败只保留一份草稿', store.getState().maintenance.lifeDrafts.filter((d) => d.eventId === 'EV-TEST-0002').length === 1);
store.dispatch(discardLifeDraft('EV-TEST-0002'));
ok('草稿可清除', !store.getState().maintenance.lifeDrafts.some((d) => d.eventId === 'EV-TEST-0002'));

// 规则：后到留冲突（不动件、不留草稿）
const conflict: LifeConflict = { eventId: 'EV-TEST-0003', heldBy: '宋杰 · 机械', message: '位置已占用', time: '10:05' };
store.dispatch(recordLifeConflict({ conflict }));
ok('冲突留痕', store.getState().maintenance.lifeConflicts.some((c) => c.eventId === 'EV-TEST-0003'));
ok('冲突不新增草稿', store.getState().maintenance.lifeDrafts.length === 0);

// 规则：三本账独立 —— 放行基线锁定后不受循环变化影响
// 前置：清掉与寿命账无关的待授权工卡（由授权人处理后继续）
store.dispatch({ type: 'maintenance/authorizeOverride' });
const card03 = store.getState().maintenance.cards.find((c) => c.id === 'CARD-03')!;
ok('授权处理后 CARD-03 不再待授权', card03.status !== '待授权');
// 补齐工卡完成数（>=6）并完成剩余非未开始门禁
store.getState().maintenance.cards.forEach((c) => {
  if (c.status !== '已完成' && c.id !== 'CARD-09') {
    store.dispatch({ type: 'maintenance/selectCard', payload: c.id });
    store.dispatch({ type: 'maintenance/updateCard', payload: { status: '已完成', measurement: '测试', finding: '测试' } });
  }
});
for (const stage of ['系统', '动力', '适航', '放行']) store.dispatch(signStage(stage));
ok('全部签署', store.getState().maintenance.signatures.every((s) => s.status === '已签署'));
ok('无待授权/草稿时可放行', (() => {
  store.dispatch(releasePackage());
  return store.getState().maintenance.released === true && store.getState().maintenance.baseline !== null;
})());
const baselineCycle = store.getState().maintenance.baseline!.airframeCycles;
ok('基线冻结当前循环', baselineCycle === store.getState().maintenance.airframeCycles);
const baselineRemainNew = store.getState().maintenance.baseline!.parts.find((p) => p.partId === 'LLP-NLG-09')!.remaining;
// 锁定后尝试调循环应被阻止
store.dispatch(adjustAirframeCycles({ delta: 10, actor: '测试', reason: '锁定后' }));
ok('锁定后循环账被阻止', store.getState().maintenance.airframeCycles === baselineCycle);
ok('基线快照值不变', store.getState().maintenance.baseline!.parts.find((p) => p.partId === 'LLP-NLG-09')!.remaining === baselineRemainNew);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
