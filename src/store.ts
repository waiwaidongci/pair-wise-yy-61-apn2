import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { maintenanceApi, type LifePart, type ReplacementPayload, type ReplacementResult, type LifeConflict } from './api';

export type StageSignature = {
  stage: string;
  status: '待签署' | '已签署' | '已失效';
  actor: string;
  time: string;
  invalidReason?: string;
};

export type OfflineCard = {
  id: string;
  title: string;
  estimated: number;
  zone: string;
  dependencies: string[];
  tolerance: string;
  evidence: string;
  witness: string;
  status: '未开始' | '执行中' | '待授权' | '已完成';
  measurement: string;
  finding: string;
  stage: string;
};

export type ReplacementDraft = ReplacementPayload & {
  reason: '离线暂存' | '写入失败';
  savedAt: string;
  attempts: number;
};

export type BaselinePart = {
  partId: string;
  pn: string;
  sn: string;
  name: string;
  position: string;
  status: LifePart['status'];
  used: number;
  remaining: number;
};

export type ReleaseBaseline = {
  revision: number;
  frozenAt: string;
  airframeCycles: number;
  parts: BaselinePart[];
} | null;

type MaintenanceState = {
  cards: OfflineCard[];
  activeCardId: string;
  syncVersion: number;
  serverVersion: number;
  offline: boolean;
  lastSaved: string;
  conflictMessage: string;
  signatures: StageSignature[];
  released: boolean;
  audit: { time: string; actor: string; action: string; detail: string }[];

  // ===== 寿命账 =====
  /** 机身循环账：独立维护的权威计数 */
  airframeCycles: number;
  /** 件履历账 */
  lifeParts: LifePart[];
  /** 寿命账服务器基线版本（与工卡 serverVersion 各自独立） */
  lifeRevision: number;
  /** 后到者留下的冲突记录 */
  lifeConflicts: LifeConflict[];
  /** 写入失败 / 离线下保留的草稿，按原事件号重试 */
  lifeDrafts: ReplacementDraft[];
  /** 寿命账页面瞬时提示 */
  lifeMessage: { intent: 'success' | 'warning' | 'error'; text: string } | null;
  /** 放行基线：锁定时的只读快照，与循环账、履历账各算各的 */
  baseline: ReleaseBaseline;
};

// ===== 寿命账纯计算 =====

/** 本段装机消耗：已拆件取拆下时固化值，装机件按当前机身循环计算 */
export function partSegmentUsed(part: LifePart, airframeCycles: number): number {
  if (part.status === '已拆') return part.frozenConsumed ?? 0;
  return Math.max(0, airframeCycles - (part.installedAtCycle ?? airframeCycles));
}

/** 累计已用循环（含件本身在上一段服役的起始值） */
export function partTotalUsed(part: LifePart, airframeCycles: number): number {
  return part.startingUsed + partSegmentUsed(part, airframeCycles);
}

export function partRemaining(part: LifePart, airframeCycles: number): number {
  return part.lifeLimit - partTotalUsed(part, airframeCycles);
}

const LIFE_DEPENDENT_STAGES = ['适航', '放行'];
const LIFE_MIN_REMAINING = 500;

const timeNow = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

const initialCards: OfflineCard[] = [
  { id: 'CARD-01', title: '右主起落架收放检查', zone: '起落架舱 RH', estimated: 3.5, dependencies: [], tolerance: '间隙 1.2–2.0 mm', evidence: '近照 + 动作记录', witness: '检验员', status: '已完成', measurement: '1.62 mm', finding: '正常', stage: '机械签署' },
  { id: 'CARD-02', title: '发动机 2 风扇叶片孔探', zone: '发动机 2', estimated: 4.2, dependencies: ['CARD-01'], tolerance: '凹坑 ≤ 0.3 mm', evidence: '孔探照片 + 视频', witness: '发动机工程师', status: '执行中', measurement: '', finding: '', stage: '发动机签署' },
  { id: 'CARD-03', title: '液压系统压力保持测试', zone: '轮舱 / 系统 A', estimated: 2.0, dependencies: ['CARD-01'], tolerance: '≥ 2850 psi / 10 min', evidence: '压力仪记录', witness: '质量检验', status: '待授权', measurement: '2762 psi', finding: '低于容差，等待授权', stage: '系统签署' },
  { id: 'CARD-04', title: '前起落架时寿件核对', zone: '前起落架', estimated: 1.5, dependencies: [], tolerance: '剩余循环 ≥ 500', evidence: '件号照片 + 履历页', witness: '检验员', status: '已完成', measurement: '剩余 836 循环', finding: '正常', stage: '适航签署' },
  { id: 'CARD-05', title: 'AD 2024-15-03 执行确认', zone: '机身后段', estimated: 2.5, dependencies: ['CARD-04'], tolerance: '按 AD 标准施工', evidence: '施工记录 + 签署', witness: '放行人员', status: '未开始', measurement: '', finding: '', stage: '适航签署' },
  { id: 'CARD-06', title: '客舱应急设备检查', zone: '客舱全舱', estimated: 2.8, dependencies: [], tolerance: '全部在有效期内', evidence: '清单复核', witness: '客舱检验', status: '未开始', measurement: '', finding: '', stage: '客舱签署' },
  { id: 'CARD-07', title: 'APU 排故后试车', zone: 'APU 舱', estimated: 3.0, dependencies: ['CARD-03'], tolerance: '参数在 AMM 范围', evidence: '试车数据 + 油样', witness: '动力工程师', status: '未开始', measurement: '', finding: '', stage: '动力签署' },
  { id: 'CARD-08', title: '重复缺陷趋势复核', zone: '全机', estimated: 1.0, dependencies: ['CARD-02', 'CARD-03'], tolerance: '无新增重复缺陷', evidence: '近 3 次记录', witness: '质量经理', status: '执行中', measurement: '发现 2 次压力偏低', finding: '移交可靠性分析', stage: '放行签署' },
  { id: 'CARD-09', title: '前起落架时寿件拆换', zone: '前起落架', estimated: 3.2, dependencies: ['CARD-04'], tolerance: '剩余循环 ≥ 500', evidence: '件号照片 + 履历页 + 称重记录', witness: '检验员', status: '执行中', measurement: '', finding: '', stage: '适航签署' }
];

const initialLifeParts = (): LifePart[] => [
  {
    id: 'LLP-NLG-01', pn: 'NLG-STRUT-3210', sn: 'SN-88421', name: '前起落架减震支柱', position: '前起落架 / 支柱',
    lifeLimit: 28000, startingUsed: 19240, status: '装机', installedAtCycle: 21430,
    events: [
      { eventId: 'EV-2023-1180', kind: '装机', cardId: '历史工卡', actor: '航线维修', airframeCycles: 21430, time: '2023-05-11 14:20' }
    ]
  },
  {
    id: 'LLP-NLG-02', pn: 'NLG-TORQUE-2077', sn: 'SN-55107', name: '前起落架扭力臂', position: '前起落架 / 扭力臂',
    lifeLimit: 22000, startingUsed: 15880, status: '装机', installedAtCycle: 21430,
    events: [
      { eventId: 'EV-2023-1181', kind: '装机', cardId: '历史工卡', actor: '航线维修', airframeCycles: 21430, time: '2023-05-11 14:20' }
    ]
  },
  {
    id: 'LLP-NLG-03', pn: 'NLG-BAR-4410', sn: 'SN-33290', name: '前起减摆器', position: '前起落架 / 减摆器',
    lifeLimit: 10400, startingUsed: 8200, status: '装机', installedAtCycle: 22980,
    events: [
      { eventId: 'EV-2019-0662', kind: '装机', cardId: '历史工卡', actor: '定检车间', airframeCycles: 16800, time: '2019-09-02 10:05' },
      { eventId: 'EV-2019-0711', kind: '拆下', cardId: '历史工卡', actor: '定检车间', airframeCycles: 17920, consumed: 1120, time: '2020-01-18 16:40' },
      { eventId: 'EV-2024-0332', kind: '装机', cardId: '历史工卡', actor: '定检车间', airframeCycles: 22980, time: '2024-04-09 11:30' }
    ]
  },
  {
    id: 'LLP-NLG-04', pn: 'NLG-ACT-1180', sn: 'SN-90114', name: '转弯作动筒', position: '前起落架 / 转弯作动筒',
    lifeLimit: 20000, startingUsed: 6400, status: '已拆',
    installedAtCycle: 20100, removedAtCycle: 22100, frozenConsumed: 2000,
    events: [
      { eventId: 'EV-2022-0904', kind: '装机', cardId: '历史工卡', actor: '航线维修', airframeCycles: 20100, time: '2022-10-30 09:50' },
      { eventId: 'EV-2024-0211', kind: '拆下', cardId: '历史工卡', actor: '定检车间', airframeCycles: 22100, consumed: 2000, time: '2024-02-26 15:15' }
    ]
  }
];

const initialSignatures = (): StageSignature[] => [
  { stage: '机械', status: '已签署', actor: '赵明 · 机械师', time: '09:18' },
  { stage: '系统', status: '待签署', actor: '待指定', time: '-' },
  { stage: '动力', status: '待签署', actor: '待指定', time: '-' },
  { stage: '适航', status: '待签署', actor: '待指定', time: '-' },
  { stage: '放行', status: '待签署', actor: '质量经理', time: '-' }
];

const memoryStorage = new Map<string, string>();
const storage = {
  getItem(key: string) {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
    return memoryStorage.has(key) ? memoryStorage.get(key)! : null;
  },
  setItem(key: string, value: string) {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    else memoryStorage.set(key, value);
  }
};

function buildInitialState(): MaintenanceState {
  const base: MaintenanceState = {
    cards: initialCards,
    activeCardId: 'CARD-03',
    syncVersion: 7,
    serverVersion: 7,
    offline: false,
    lastSaved: '09:46',
    conflictMessage: '',
    signatures: initialSignatures(),
    released: false,
    audit: [
      { time: '08:54', actor: '赵明', action: '完成工卡', detail: 'CARD-01 间隙测量 1.62 mm' },
      { time: '09:05', actor: '宋杰', action: '提交测量', detail: 'CARD-03 压力 2762 psi，低于容差' },
      { time: '09:20', actor: '系统', action: '阻断', detail: 'CARD-03 等待授权处理' }
    ],
    airframeCycles: 24318,
    lifeParts: initialLifeParts(),
    lifeRevision: 7,
    lifeConflicts: [],
    lifeDrafts: [],
    lifeMessage: null,
    baseline: null
  };

  const raw = storage.getItem('yy61-work-package');
  if (!raw) return recomputeLife(base);
  try {
    const saved = JSON.parse(raw) as Partial<MaintenanceState>;
    const merged: MaintenanceState = {
      ...base,
      ...saved,
      // 旧版本存档缺寿命账字段时回落到初始账
      airframeCycles: typeof saved.airframeCycles === 'number' ? saved.airframeCycles : base.airframeCycles,
      lifeParts: Array.isArray(saved.lifeParts) && saved.lifeParts.length > 0 ? saved.lifeParts as LifePart[] : base.lifeParts,
      lifeRevision: typeof saved.lifeRevision === 'number' ? saved.lifeRevision : base.lifeRevision,
      lifeConflicts: Array.isArray(saved.lifeConflicts) ? saved.lifeConflicts as LifeConflict[] : [],
      lifeDrafts: Array.isArray(saved.lifeDrafts) ? saved.lifeDrafts as ReplacementDraft[] : [],
      lifeMessage: null,
      baseline: saved.baseline ?? null,
      signatures: Array.isArray(saved.signatures) && saved.signatures.length === 5 ? saved.signatures as StageSignature[] : base.signatures,
      cards: mergeCards(saved.cards),
      audit: Array.isArray(saved.audit) ? saved.audit : base.audit
    };
    return recomputeLife(merged);
  } catch {
    return recomputeLife(base);
  }
}

/** 老存档可能缺少 CARD-09（时寿件拆换工卡），补齐以保持工卡-寿命账挂接 */
function mergeCards(savedCards?: OfflineCard[]): OfflineCard[] {
  if (!Array.isArray(savedCards)) return initialCards;
  const merged = [...savedCards];
  for (const card of initialCards) {
    if (!merged.some((item) => item.id === card.id)) merged.push(card);
  }
  return merged;
}

/** 只重算当前装机件；已拆件保留拆下时的固化原值 */
function recomputeLife(state: MaintenanceState): MaintenanceState {
  // 装机件的剩余寿命由机身循环账派生；已拆件不再参与，frozen 值原样保留
  // （此处保留集中入口，组件侧通过 partRemaining 等纯函数读取）
  return state;
}

/** 循环或履历变化后，让依赖寿命账的已签署阶段失效（未签署/已失效不动） */
function invalidateLifeSignatures(state: MaintenanceState, reason: string) {
  for (const signature of state.signatures) {
    if (LIFE_DEPENDENT_STAGES.includes(signature.stage) && signature.status === '已签署') {
      signature.status = '已失效';
      signature.invalidReason = reason;
      state.audit.unshift({ time: timeNow(), actor: '寿命账', action: '签字失效', detail: `${signature.stage}签署因${reason}失效，需重新签署` });
    }
  }
}

const initialState = buildInitialState();

const slice = createSlice({
  name: 'maintenance',
  initialState,
  reducers: {
    selectCard(state, action: PayloadAction<string>) {
      state.activeCardId = action.payload;
    },
    updateCard(state, action: PayloadAction<Partial<OfflineCard>>) {
      const card = state.cards.find((item) => item.id === state.activeCardId);
      if (!card) return;
      Object.assign(card, action.payload);
      state.syncVersion += 1;
      state.lastSaved = timeNow();
      state.audit.unshift({ time: state.lastSaved, actor: '当前用户', action: '离线暂存', detail: `${card.id} 已保存本地草稿` });
    },
    setConflict(state, action: PayloadAction<string>) {
      state.conflictMessage = action.payload;
    },
    refreshVersion(state) {
      state.syncVersion = state.serverVersion;
      state.conflictMessage = '';
    },
    toggleOffline(state) {
      state.offline = !state.offline;
    },
    authorizeOverride(state) {
      const card = state.cards.find((item) => item.id === state.activeCardId);
      if (!card) return;
      card.status = '执行中';
      card.finding = '超差已由授权人员批准，按工程指令继续';
      state.audit.unshift({ time: timeNow(), actor: '放行授权人', action: '授权继续', detail: `${card.id} 超差放行审批` });
    },
    signStage(state, action: PayloadAction<string>) {
      const signature = state.signatures.find((item) => item.stage === action.payload);
      if (!signature) return;
      signature.status = '已签署';
      signature.actor = `${action.payload}负责人`;
      signature.time = timeNow();
      delete signature.invalidReason;
      state.audit.unshift({ time: signature.time, actor: signature.actor, action: '阶段签署', detail: `${action.payload}阶段确认完成` });
    },
    releasePackage(state) {
      const hasBlockers = state.cards.some((card) => card.status === '待授权');
      const allSigned = state.signatures.every((item) => item.status === '已签署');
      const hasDrafts = state.lifeDrafts.length > 0;
      const lifeShort = state.lifeParts
        .filter((part) => part.status === '装机')
        .some((part) => partRemaining(part, state.airframeCycles) < LIFE_MIN_REMAINING);
      if (!hasBlockers && allSigned && !hasDrafts && !lifeShort) {
        state.released = true;
        // 放行基线：对循环账与件履历账在锁定时刻做只读快照
        state.baseline = {
          revision: state.lifeRevision,
          frozenAt: timeNow(),
          airframeCycles: state.airframeCycles,
          parts: state.lifeParts.map((part) => ({
            partId: part.id, pn: part.pn, sn: part.sn, name: part.name, position: part.position,
            status: part.status, used: partTotalUsed(part, state.airframeCycles), remaining: partRemaining(part, state.airframeCycles)
          }))
        };
        state.audit.unshift({ time: timeNow(), actor: '质量经理', action: '锁定放行', detail: `工作包 R7 已锁定；放行基线 R${state.lifeRevision} 冻结于机身循环 ${state.airframeCycles}` });
      }
    },

    // ===== 寿命账 =====

    /** 机身循环账变化：只影响当前装机件，已拆件固化值不动；依赖签字失效 */
    adjustAirframeCycles(state, action: PayloadAction<{ delta: number; actor: string; reason: string }>) {
      if (state.released) {
        state.lifeMessage = { intent: 'warning', text: '工作包已锁定放行基线，不能再调整机身循环。' };
        return;
      }
      const before = state.airframeCycles;
      const next = before + action.payload.delta;
      if (next < 0) return;
      state.airframeCycles = next;
      state.audit.unshift({
        time: timeNow(), actor: action.payload.actor, action: '机身循环',
        detail: `机身循环 ${before} → ${next}（${action.payload.reason}）；仅重算装机件`
      });
      invalidateLifeSignatures(state, `机身循环调整为 ${next}`);
      state.lifeMessage = { intent: 'success', text: `机身循环已记 ${next}；当前装机件已重算，已拆件保留拆下原值。` };
    },

    /** 件履历修正（仅装机件；已拆件履历封存）：重算该件并失效依赖签字 */
    correctLifeHistory(state, action: PayloadAction<{ partId: string; startingUsed?: number; lifeLimit?: number; actor: string }>) {
      if (state.released) {
        state.lifeMessage = { intent: 'warning', text: '已锁定放行，履历修正被阻止。' };
        return;
      }
      const part = state.lifeParts.find((item) => item.id === action.payload.partId);
      if (!part || part.status !== '装机') return;
      if (typeof action.payload.startingUsed === 'number') part.startingUsed = action.payload.startingUsed;
      if (typeof action.payload.lifeLimit === 'number') part.lifeLimit = action.payload.lifeLimit;
      state.audit.unshift({
        time: timeNow(), actor: action.payload.actor, action: '履历修正',
        detail: `${part.id}（${part.name}）履历已修正并重新计寿`
      });
      invalidateLifeSignatures(state, `${part.id} 件履历修正`);
      state.lifeMessage = { intent: 'success', text: `${part.id} 履历已修正，当前装机件重算完成。` };
    },

    /**
     * 应用一笔被服务端接受的拆换：
     * 旧件拆下固化消耗（之后循环再涨也不变），新件装机冻结当前机身循环。
     * 同一 eventId 重复到达时只做幂等确认，不重复入账。
     */
    applyReplacement(state, action: PayloadAction<{ result: ReplacementResult; cardId: string; actor: string }>) {
      const { result } = action.payload;
      const eventId = result.event.eventId;
      const alreadyApplied = state.lifeParts.some((part) => part.events.some((event) => event.eventId === eventId));
      if (alreadyApplied) {
        state.lifeMessage = { intent: 'warning', text: `事件号 ${eventId} 已入账，本次为幂等重试返回，未重复记账。` };
        state.lifeDrafts = state.lifeDrafts.filter((draft) => draft.eventId !== eventId);
        return;
      }

      const removed = state.lifeParts.find((part) => part.id === result.event.removedPartId && part.status === '装机');
      if (removed) {
        removed.status = '已拆';
        removed.removedAtCycle = result.event.airframeCycles;
        removed.frozenConsumed = result.event.consumed;
        if (!removed.events.some((event) => event.eventId === `${eventId}-OFF`)) {
          removed.events.push({
            eventId: `${eventId}-OFF`, kind: '拆下', cardId: action.payload.cardId, actor: action.payload.actor,
            airframeCycles: result.event.airframeCycles, consumed: result.event.consumed, time: result.event.time
          });
        }
      }

      if (!state.lifeParts.some((part) => part.id === result.event.newPart.id)) {
        state.lifeParts.unshift(result.event.newPart);
      }
      state.airframeCycles = result.event.airframeCycles;
      state.lifeRevision = result.revision;
      state.lifeDrafts = state.lifeDrafts.filter((draft) => draft.eventId !== eventId);

      // 工卡与寿命账挂接：拆换工卡按结果关闭
      const card = state.cards.find((item) => item.id === action.payload.cardId);
      if (card) {
        card.status = '已完成';
        card.measurement = `新装 ${result.event.newPart.id} 冻结@${result.event.airframeCycles}`;
        card.finding = `拆 ${result.event.removedPartId}，本段固化消耗 ${result.event.consumed} 循环`;
      }

      invalidateLifeSignatures(state, `时寿件拆换（${eventId}）`);
      state.audit.unshift({
        time: result.event.time, actor: action.payload.actor, action: '时寿件拆换',
        detail: `${eventId}：拆 ${result.event.removedPartId}（固化消耗 ${result.event.consumed}），装 ${result.event.newPart.id}（${result.event.newPart.sn}）@${result.event.airframeCycles}`
      });
      state.lifeMessage = {
        intent: 'success',
        text: `拆换已入账：旧件拆下固化消耗 ${result.event.consumed} 循环；新件装机冻结于机身循环 ${result.event.airframeCycles}，寿命账升至 R${result.revision}。`
      };
    },

    /** 写入失败 / 离线下保留草稿（同事件号覆盖更新，不新增） */
    saveLifeDraft(state, action: PayloadAction<{ draft: ReplacementDraft }>) {
      const { draft } = action.payload;
      const existing = state.lifeDrafts.find((item) => item.eventId === draft.eventId);
      if (existing) {
        Object.assign(existing, draft, { attempts: existing.attempts + 1 });
      } else {
        state.lifeDrafts.unshift(draft);
      }
      state.audit.unshift({
        time: timeNow(), actor: draft.actor,
        action: draft.reason === '离线暂存' ? '草稿暂存' : '写入失败',
        detail: `${draft.eventId} 拆 ${draft.removedPartId} 草稿已保留，可按原事件号重试`
      });
      state.lifeMessage = {
        intent: draft.reason === '离线暂存' ? 'warning' : 'error',
        text: draft.reason === '离线暂存'
          ? `当前离线，草稿（${draft.eventId}）已保留，恢复在线后按原事件号提交。`
          : `写入失败，草稿（${draft.eventId}）已保留，按原事件号重试不会重复记账。`
      };
    },

    retryLifeDraftAttempt(state, action: PayloadAction<string>) {
      const draft = state.lifeDrafts.find((item) => item.eventId === action.payload);
      if (draft) draft.attempts += 1;
    },

    discardLifeDraft(state, action: PayloadAction<string>) {
      const draft = state.lifeDrafts.find((item) => item.eventId === action.payload);
      state.lifeDrafts = state.lifeDrafts.filter((item) => item.eventId !== action.payload);
      if (draft) {
        state.audit.unshift({ time: timeNow(), actor: draft.actor, action: '草稿放弃', detail: `${action.payload} 草稿已删除` });
      }
    },

    /** 后到者：留冲突（不覆盖已占用件，不产生草稿） */
    recordLifeConflict(state, action: PayloadAction<{ conflict: LifeConflict }>) {
      if (!state.lifeConflicts.some((item) => item.eventId === action.payload.conflict.eventId)) {
        state.lifeConflicts.unshift(action.payload.conflict);
      }
      state.audit.unshift({
        time: action.payload.conflict.time, actor: '寿命账', action: '并发冲突',
        detail: action.payload.conflict.message
      });
      state.lifeMessage = { intent: 'error', text: action.payload.conflict.message };
    },

    /** 拉取服务端在途冲突留痕（他人视角），不覆盖本地件履历与基线版本 */
    syncLifeServer(state, action: PayloadAction<{ conflicts: LifeConflict[] }>) {
      for (const conflict of action.payload.conflicts) {
        if (!state.lifeConflicts.some((item) => item.eventId === conflict.eventId)) {
          state.lifeConflicts.unshift(conflict);
        }
      }
    },

    /**
     * 手动刷新对账：服务器修订更高时，以服务器的循环账/件履历为准。
     * 本地草稿与冲突保留；若寿命结果有变，依赖签字失效。
     */
    reconcileLifeServer(state, action: PayloadAction<{ revision: number; airframeCycles: number; parts: LifePart[]; conflicts: LifeConflict[] }>) {
      const snapshot = action.payload;
      for (const conflict of snapshot.conflicts) {
        if (!state.lifeConflicts.some((item) => item.eventId === conflict.eventId)) {
          state.lifeConflicts.unshift(conflict);
        }
      }
      if (snapshot.revision <= state.lifeRevision) return;
      const lifeChanged =
        snapshot.airframeCycles !== state.airframeCycles ||
        snapshot.parts.length !== state.lifeParts.length ||
        snapshot.parts.some((part) => {
          const local = state.lifeParts.find((item) => item.id === part.id);
          return !local || local.status !== part.status || local.events.length !== part.events.length
            || (local.status === '装机' && local.installedAtCycle !== part.installedAtCycle);
        });
      state.lifeParts = snapshot.parts;
      state.airframeCycles = snapshot.airframeCycles;
      state.lifeRevision = snapshot.revision;
      if (lifeChanged) {
        invalidateLifeSignatures(state, `服务器寿命账更新至 R${snapshot.revision}`);
        state.lifeMessage = { intent: 'warning', text: `已按服务器 R${snapshot.revision} 对账：装机件已重算，本地未提交内容以草稿保留。` };
      } else {
        state.lifeMessage = { intent: 'success', text: `寿命账已刷新至 R${snapshot.revision}。` };
      }
    },

    setLifeMessage(state, action: PayloadAction<{ intent: 'success' | 'warning' | 'error'; text: string }>) {
      state.lifeMessage = action.payload;
    },

    clearLifeMessage(state) {
      state.lifeMessage = null;
    }
  }
});

export const {
  selectCard, updateCard, setConflict, refreshVersion, toggleOffline, authorizeOverride, signStage, releasePackage,
  adjustAirframeCycles, correctLifeHistory, applyReplacement, saveLifeDraft, retryLifeDraftAttempt,
  discardLifeDraft, recordLifeConflict, reconcileLifeServer, setLifeMessage, syncLifeServer, clearLifeMessage
} = slice.actions;

export { LIFE_MIN_REMAINING };

export const store = configureStore({
  reducer: { maintenance: slice.reducer, [maintenanceApi.reducerPath]: maintenanceApi.reducer },
  middleware: (getDefault) => getDefault().concat(maintenanceApi.middleware)
});

store.subscribe(() => {
  storage.setItem('yy61-work-package', JSON.stringify(store.getState().maintenance));
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
