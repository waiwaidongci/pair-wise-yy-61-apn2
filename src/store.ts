import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { maintenanceApi, lifeData, type LifePart, type LifeEventRecord } from './api';

export type StageSignature = { stage: string; status: '待签署' | '已签署'; actor: string; time: string };
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
  fuselageCycles: number; // 机身循环（寿命账基准）
  lifeParts: LifePart[]; // 时寿件台账
  lifeEvents: LifeEventRecord[]; // 寿命账事件（含草稿/冲突/失败）
};

const initialCards: OfflineCard[] = [
  { id: 'CARD-01', title: '右主起落架收放检查', zone: '起落架舱 RH', estimated: 3.5, dependencies: [], tolerance: '间隙 1.2–2.0 mm', evidence: '近照 + 动作记录', witness: '检验员', status: '已完成', measurement: '1.62 mm', finding: '正常', stage: '机械签署' },
  { id: 'CARD-02', title: '发动机 2 风扇叶片孔探', zone: '发动机 2', estimated: 4.2, dependencies: ['CARD-01'], tolerance: '凹坑 ≤ 0.3 mm', evidence: '孔探照片 + 视频', witness: '发动机工程师', status: '执行中', measurement: '', finding: '', stage: '发动机签署' },
  { id: 'CARD-03', title: '液压系统压力保持测试', zone: '轮舱 / 系统 A', estimated: 2.0, dependencies: ['CARD-01'], tolerance: '≥ 2850 psi / 10 min', evidence: '压力仪记录', witness: '质量检验', status: '待授权', measurement: '2762 psi', finding: '低于容差，等待授权', stage: '系统签署' },
  { id: 'CARD-04', title: '前起落架时寿件核对', zone: '前起落架', estimated: 1.5, dependencies: [], tolerance: '剩余循环 ≥ 500', evidence: '件号照片 + 履历页', witness: '检验员', status: '已完成', measurement: '剩余 836 循环', finding: '正常', stage: '适航签署' },
  { id: 'CARD-05', title: 'AD 2024-15-03 执行确认', zone: '机身后段', estimated: 2.5, dependencies: ['CARD-04'], tolerance: '按 AD 标准施工', evidence: '施工记录 + 签署', witness: '放行人员', status: '未开始', measurement: '', finding: '', stage: '适航签署' },
  { id: 'CARD-06', title: '客舱应急设备检查', zone: '客舱全舱', estimated: 2.8, dependencies: [], tolerance: '全部在有效期内', evidence: '清单复核', witness: '客舱检验', status: '未开始', measurement: '', finding: '', stage: '客舱签署' },
  { id: 'CARD-07', title: 'APU 排故后试车', zone: 'APU 舱', estimated: 3.0, dependencies: ['CARD-03'], tolerance: '参数在 AMM 范围', evidence: '试车数据 + 油样', witness: '动力工程师', status: '未开始', measurement: '', finding: '', stage: '动力签署' },
  { id: 'CARD-08', title: '重复缺陷趋势复核', zone: '全机', estimated: 1.0, dependencies: ['CARD-02', 'CARD-03'], tolerance: '无新增重复缺陷', evidence: '近 3 次记录', witness: '质量经理', status: '执行中', measurement: '发现 2 次压力偏低', finding: '移交可靠性分析', stage: '放行签署' }
];

const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('yy61-work-package') : null;
const saved = raw ? JSON.parse(raw) : null;
const defaultState: MaintenanceState = {
  cards: initialCards,
  activeCardId: 'CARD-03',
  syncVersion: 7,
  serverVersion: 7,
  offline: false,
  lastSaved: '09:46',
  conflictMessage: '',
  signatures: [
    { stage: '机械', status: '已签署', actor: '赵明 · 机械师', time: '09:18' },
    { stage: '系统', status: '待签署', actor: '待指定', time: '-' },
    { stage: '动力', status: '待签署', actor: '待指定', time: '-' },
    { stage: '放行', status: '待签署', actor: '质量经理', time: '-' }
  ],
  released: false,
  audit: [
    { time: '08:54', actor: '赵明', action: '完成工卡', detail: 'CARD-01 间隙测量 1.62 mm' },
    { time: '09:05', actor: '宋杰', action: '提交测量', detail: 'CARD-03 压力 2762 psi，低于容差' },
    { time: '09:20', actor: '系统', action: '阻断', detail: 'CARD-03 等待授权处理' }
  ],
  fuselageCycles: lifeData.fuselageCycles,
  lifeParts: lifeData.parts,
  lifeEvents: []
};
const initialState: MaintenanceState = saved ? { ...defaultState, ...saved } : defaultState;

// 寿命账：循环/履历变化后只重算当前装机件，已拆件保留原值
function recalcInstalledParts(parts: LifePart[], fuselageCycles: number): LifePart[] {
  return parts.map((part) => {
    if (part.status === '已拆') return part; // 已拆件保留原值，不参与重算
    const currentCycles = fuselageCycles - part.installCycles;
    return { ...part, currentCycles, remainingCycles: part.limitCycles - currentCycles };
  });
}

// 依赖签字：寿命账变化后失效，需重新签署
const LIFE_DEPENDENT_STAGES = ['机械', '放行'];
function invalidateDependentSignatures(signatures: StageSignature[]): StageSignature[] {
  return signatures.map((item) =>
    LIFE_DEPENDENT_STAGES.includes(item.stage) && item.status === '已签署'
      ? { ...item, status: '待签署' as const, actor: '待指定', time: '-' }
      : item
  );
}

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
      state.lastSaved = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
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
      state.audit.unshift({ time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), actor: '放行授权人', action: '授权继续', detail: `${card.id} 超差放行审批` });
    },
    signStage(state, action: PayloadAction<string>) {
      const signature = state.signatures.find((item) => item.stage === action.payload);
      if (!signature) return;
      signature.status = '已签署';
      signature.actor = `${action.payload}负责人`;
      signature.time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      state.audit.unshift({ time: signature.time, actor: signature.actor, action: '阶段签署', detail: `${action.payload}阶段确认完成` });
    },
    releasePackage(state) {
      const hasBlockers = state.cards.some((card) => card.status === '待授权');
      const allSigned = state.signatures.every((item) => item.status === '已签署');
      // 寿命账门禁：所有在装时寿件剩余循环 ≥ 500，已拆件保留固化值不参与判定
      const llpOk = state.lifeParts.every((part) => part.status === '已拆' || part.remainingCycles >= 500);
      if (!hasBlockers && allSigned && llpOk) {
        state.released = true;
        state.audit.unshift({ time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), actor: '质量经理', action: '锁定放行', detail: '工作包 R7 已锁定并形成放行基线（时寿件寿命账已核验）' });
      }
    },
    // ---- 寿命账 ----
    updateFuselageCycles(state, action: PayloadAction<number>) {
      const previous = state.fuselageCycles;
      state.fuselageCycles = action.payload;
      // 只重算当前装机件，已拆件保留原值
      state.lifeParts = recalcInstalledParts(state.lifeParts, action.payload);
      // 依赖签字失效，放行基线作废
      state.signatures = invalidateDependentSignatures(state.signatures);
      state.released = false;
      state.audit.unshift({ time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), actor: '当前用户', action: '循环更新', detail: `机身循环 ${previous} → ${action.payload}，在装件已重算，依赖签字失效` });
    },
    correctPartHistory(state, action: PayloadAction<{ partId: string; installCycles: number }>) {
      const part = state.lifeParts.find((item) => item.id === action.payload.partId);
      if (!part) return;
      const previous = part.installCycles;
      part.installCycles = action.payload.installCycles;
      // 只重算当前装机件；已拆件保留原值，不参与重算
      if (part.status === '在装') {
        const currentCycles = state.fuselageCycles - part.installCycles;
        part.currentCycles = currentCycles;
        part.remainingCycles = part.limitCycles - currentCycles;
      }
      // 依赖签字失效，放行基线作废
      state.signatures = invalidateDependentSignatures(state.signatures);
      state.released = false;
      state.audit.unshift({ time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), actor: '当前用户', action: '履历修正', detail: `${part.id} 装机循环 ${previous} → ${action.payload.installCycles}，在装件已重算，依赖签字失效` });
    },
    installLifePart(state, action: PayloadAction<{ partNumber: string; serial: string; name: string; location: string; limitCycles: number; workCardId: string }>) {
      const id = `LLP-${String(state.lifeParts.length + 1).padStart(3, '0')}`;
      // 装机冻结机身循环
      state.lifeParts.push({
        id,
        ...action.payload,
        status: '在装',
        installCycles: state.fuselageCycles,
        installDate: new Date().toISOString().slice(0, 10),
        currentCycles: 0,
        remainingCycles: action.payload.limitCycles
      });
      state.audit.unshift({ time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), actor: '当前用户', action: '装机入账', detail: `${id} ${action.payload.name} 装机，冻结机身循环 ${state.fuselageCycles}` });
    },
    removeLifePart(state, action: PayloadAction<{ partId: string; reason: string }>) {
      const part = state.lifeParts.find((item) => item.id === action.payload.partId);
      if (!part || part.status !== '在装') return;
      // 拆下固化消耗
      part.removeCycles = state.fuselageCycles - part.installCycles;
      part.currentCycles = part.removeCycles;
      part.remainingCycles = part.limitCycles - part.removeCycles;
      part.status = '已拆';
      part.removeDate = new Date().toISOString().slice(0, 10);
      part.removeReason = action.payload.reason;
      state.audit.unshift({ time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), actor: '当前用户', action: '拆下固化', detail: `${part.id} ${part.name} 拆下，固化消耗 ${part.removeCycles} 循环` });
    },
    recordLifeEvent(state, action: PayloadAction<LifeEventRecord>) {
      const index = state.lifeEvents.findIndex((item) => item.eventNo === action.payload.eventNo);
      if (index >= 0) {
        state.lifeEvents[index] = action.payload; // 同事件号更新（幂等）
      } else {
        state.lifeEvents.unshift(action.payload);
      }
    }
  }
});

export const { selectCard, updateCard, setConflict, refreshVersion, toggleOffline, authorizeOverride, signStage, releasePackage, updateFuselageCycles, correctPartHistory, installLifePart, removeLifePart, recordLifeEvent } = slice.actions;

export const store = configureStore({
  reducer: { maintenance: slice.reducer, [maintenanceApi.reducerPath]: maintenanceApi.reducer },
  middleware: (getDefault) => getDefault().concat(maintenanceApi.middleware)
});

store.subscribe(() => {
  if (typeof localStorage !== 'undefined') localStorage.setItem('yy61-work-package', JSON.stringify(store.getState().maintenance));
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
