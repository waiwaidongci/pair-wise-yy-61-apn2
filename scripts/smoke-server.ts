import { maintenanceApi } from '../src/api';
import type { ReplacementPayload } from '../src/api';

const [reducerPath] = ['maintenanceApi'];
// 直接拿 endpoint 的 queryFn 做并发测试，无需起 store
const submit = (maintenanceApi.endpoints.submitReplacement as any).initiate as undefined;
void submit;
void reducerPath;

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name); }
};

// 直接调用内部 queryFn：通过 createApi 不便，改为通过 dispatch 一个最小 store
import { configureStore } from '@reduxjs/toolkit';
const store = configureStore({
  reducer: { [maintenanceApi.reducerPath]: maintenanceApi.reducer },
  middleware: (getDefault) => getDefault().concat(maintenanceApi.middleware)
});

const base = (eventId: string, actor: string, fail = false): ReplacementPayload => ({
  eventId, cardId: 'CARD-09', removedPartId: 'LLP-NLG-02', position: '前起落架 / 扭力臂',
  newPartNumber: 'PN-X', newSerial: `SN-${eventId}`, newLifeLimit: 24000,
  airframeCycles: 24318, actor, expectedRevision: 7, forceFailure: fail
});

const unwrap = async (p: Promise<any>) => {
  try { const r = await p; return r.data ? { ok: true, data: r.data } : { ok: false, error: r.error }; }
  catch (e) { return { ok: false, error: (e as any) }; }
};

(async () => {
  // 1) 两人并发同一件：先到占锁成功，后到 409
  const a = store.dispatch((maintenanceApi.endpoints.submitReplacement as any).initiate(base('EV-CONC-A', '宋杰 · 机械')));
  const b = store.dispatch((maintenanceApi.endpoints.submitReplacement as any).initiate(base('EV-CONC-B', '周凯 · 机械')));
  const [ra, rb] = await Promise.all([unwrap(a), unwrap(b)]);
  ok('先到占用成功', ra.ok === true && ra.data.accepted === true);
  ok('后到 409 冲突', rb.ok === false && rb.error.status === 409);
  ok('后到冲突带占用者', rb.ok === false && rb.error.data.heldBy === '宋杰 · 机械');

  // 并发成功后服务端版本已推进；草稿重试需跟随刷新后的基线版本；另选一件未拆的支柱
  const serverNow = await store.dispatch((maintenanceApi.endpoints.getLifeServer as any).initiate());
  const rev = (serverNow.data ?? serverNow).revision as number;
  const baseRev = (eventId: string, actor: string, fail = false): ReplacementPayload => ({
    ...base(eventId, actor, fail),
    removedPartId: 'LLP-NLG-01', position: '前起落架 / 支柱',
    expectedRevision: rev
  });

  // 2) 500 失败后，按原事件号重试成功（不产生双账）
  const failRun = await unwrap(store.dispatch((maintenanceApi.endpoints.submitReplacement as any).initiate(baseRev('EV-RETRY-1', '宋杰 · 机械', true))));
  ok('模拟写入失败返回 500', failRun.ok === false && failRun.error.status === 500);
  const retry1 = await unwrap(store.dispatch((maintenanceApi.endpoints.submitReplacement as any).initiate(baseRev('EV-RETRY-1', '宋杰 · 机械', false))));
  ok('原事件号重试成功', retry1.ok === true);
  const retry2 = await unwrap(store.dispatch((maintenanceApi.endpoints.submitReplacement as any).initiate(baseRev('EV-RETRY-1', '宋杰 · 机械', false))));
  ok('再次提交同事件号幂等返回', retry2.ok === true && retry2.data.idempotent === true);

  // 3) 拆下固化 / 装机冻结语义在服务端结果中（支柱同样装机冻结于 21430）
  ok('拆换结果含固化消耗', retry1.ok && typeof retry1.data.event.consumed === 'number' && retry1.data.event.consumed === 24318 - 21430);
  ok('新件装机冻结于提交循环', retry1.ok && retry1.data.event.newPart.installedAtCycle === 24318);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
