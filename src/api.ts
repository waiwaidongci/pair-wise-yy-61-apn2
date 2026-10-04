import { createApi } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn } from '@reduxjs/toolkit/query';

export type WorkCard = {
  id: string;
  title: string;
  zone: string;
  revision: string;
  estimated: number;
  dependencies: string[];
  tolerance: string;
  evidence: string;
  witness: string;
  status: '未开始' | '执行中' | '待授权' | '已完成';
  measurement: string;
  finding: string;
  stage: string;
};

// ===== 时寿件 / 寿命账（服务端模型） =====

export type LifePartStatus = '装机' | '已拆';

/** 件履历中的一条装机/拆换事件 */
export type LifeEvent = {
  eventId: string;
  kind: '装机' | '拆下';
  cardId: string;
  actor: string;
  airframeCycles: number;
  time: string;
  /** 拆下时固化的本循环段消耗（仅拆下事件） */
  consumed?: number;
};

export type LifePart = {
  id: string;
  pn: string;
  sn: string;
  name: string;
  position: string;
  lifeLimit: number;
  /** 新件/出厂时已使用循环（一般为 0） */
  startingUsed: number;
  status: LifePartStatus;
  events: LifeEvent[];
  /** 当前装机件：装机冻结的机身循环；已拆件：拆下固化值（此后不再变化） */
  installedAtCycle?: number;
  removedAtCycle?: number;
  frozenConsumed?: number;
};

/** 拆换提交（占用锁 + 幂等的服务端） */
export type ReplacementPayload = {
  eventId: string;
  cardId: string;
  removedPartId: string;
  position: string;
  newPartNumber: string;
  newSerial: string;
  newLifeLimit: number;
  airframeCycles: number;
  actor: string;
  expectedRevision: number;
  /** 演示用：强制本次写入 500（保留草稿，可按原事件号重试） */
  forceFailure?: boolean;
};

export type ReplacementResult = {
  accepted: boolean;
  idempotent?: boolean;
  revision: number;
  event: {
    eventId: string;
    removedPartId: string;
    consumed: number;
    newPart: LifePart;
    airframeCycles: number;
    time: string;
  };
};

export type LifeConflict = {
  eventId: string;
  heldBy: string;
  message: string;
  time: string;
};

export type LifeServerState = {
  revision: number;
  airframeCycles: number;
  parts: LifePart[];
  conflicts: LifeConflict[];
  locks: { position: string; holder: string; eventId: string }[];
};

// ===== 初始数据 =====

const now = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

function initialParts(): LifePart[] {
  return [
    {
      id: 'LLP-NLG-01', pn: 'NLG-STRUT-3210', sn: 'SN-88421', name: '前起落架减震支柱', position: '前起落架 / 支柱',
      lifeLimit: 28000, startingUsed: 19240, status: '装机',
      installedAtCycle: 21430,
      events: [
        { eventId: 'EV-2023-1180', kind: '装机', cardId: '历史工卡', actor: '航线维修', airframeCycles: 21430, time: '2023-05-11 14:20' }
      ]
    },
    {
      id: 'LLP-NLG-02', pn: 'NLG-TORQUE-2077', sn: 'SN-55107', name: '前起落架扭力臂', position: '前起落架 / 扭力臂',
      lifeLimit: 22000, startingUsed: 15880, status: '装机',
      installedAtCycle: 21430,
      events: [
        { eventId: 'EV-2023-1181', kind: '装机', cardId: '历史工卡', actor: '航线维修', airframeCycles: 21430, time: '2023-05-11 14:20' }
      ]
    },
    {
      id: 'LLP-NLG-03', pn: 'NLG-BAR-4410', sn: 'SN-33290', name: '前起减摆器', position: '前起落架 / 减摆器',
      lifeLimit: 10400, startingUsed: 8200, status: '装机',
      installedAtCycle: 22980,
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
}

/** mock 服务端：锁随会话存在；事件号幂等；先到占用，后到冲突 */
const cloneParts = (parts: LifePart[]): LifePart[] => parts.map((part) => ({ ...part, events: part.events.map((event) => ({ ...event })) }));
const server: LifeServerState = {
  revision: 7,
  airframeCycles: 24318,
  parts: cloneParts(initialParts()),
  conflicts: [],
  locks: []
};

const inflightLocks = new Map<string, { holder: string; eventId: string }>();
const idempotency = new Map<string, ReplacementResult>();
let partSeq = 4;

const packageData = {
  id: 'WP-B7891-04',
  aircraft: 'B-7891',
  type: 'B737-800',
  check: '48A 定检',
  station: '上海浦东 · H3 机库',
  plannedStart: '2026-09-28 06:00',
  plannedEnd: '2026-09-30 18:00',
  revision: 'WP R7',
  serverRevision: 7,
  tasks: [
    { id: 'CARD-01', title: '右主起落架收放检查', zone: '起落架舱 RH', revision: 'R7', estimated: 3.5, dependencies: [], tolerance: '间隙 1.2–2.0 mm', evidence: '近照 + 动作记录', witness: '检验员', status: '已完成', measurement: '1.62 mm', finding: '正常', stage: '机械签署' },
    { id: 'CARD-02', title: '发动机 2 风扇叶片孔探', zone: '发动机 2', revision: 'R7', estimated: 4.2, dependencies: ['CARD-01'], tolerance: '凹坑 ≤ 0.3 mm', evidence: '孔探照片 + 视频', witness: '发动机工程师', status: '执行中', measurement: '', finding: '', stage: '发动机签署' },
    { id: 'CARD-03', title: '液压系统压力保持测试', zone: '轮舱 / 系统 A', revision: 'R6', estimated: 2.0, dependencies: ['CARD-01'], tolerance: '≥ 2850 psi / 10 min', evidence: '压力仪记录', witness: '质量检验', status: '待授权', measurement: '2762 psi', finding: '低于容差，等待授权', stage: '系统签署' },
    { id: 'CARD-04', title: '前起落架时寿件核对', zone: '前起落架', revision: 'R7', estimated: 1.5, dependencies: [], tolerance: '剩余循环 ≥ 500', evidence: '件号照片 + 履历页', witness: '检验员', status: '已完成', measurement: '剩余 836 循环', finding: '正常', stage: '适航签署' },
    { id: 'CARD-05', title: 'AD 2024-15-03 执行确认', zone: '机身后段', revision: 'R7', estimated: 2.5, dependencies: ['CARD-04'], tolerance: '按 AD 标准施工', evidence: '施工记录 + 签署', witness: '放行人员', status: '未开始', measurement: '', finding: '', stage: '适航签署' },
    { id: 'CARD-06', title: '客舱应急设备检查', zone: '客舱全舱', revision: 'R7', estimated: 2.8, dependencies: [], tolerance: '全部在有效期内', evidence: '清单复核', witness: '客舱检验', status: '未开始', measurement: '', finding: '', stage: '客舱签署' },
    { id: 'CARD-07', title: 'APU 排故后试车', zone: 'APU 舱', revision: 'R5', estimated: 3.0, dependencies: ['CARD-03'], tolerance: '参数在 AMM 范围', evidence: '试车数据 + 油样', witness: '动力工程师', status: '未开始', measurement: '', finding: '', stage: '动力签署' },
    { id: 'CARD-08', title: '重复缺陷趋势复核', zone: '全机', revision: 'R7', estimated: 1.0, dependencies: ['CARD-02', 'CARD-03'], tolerance: '无新增重复缺陷', evidence: '近 3 次记录', witness: '质量经理', status: '执行中', measurement: '发现 2 次压力偏低', finding: '移交可靠性分析', stage: '放行签署' },
    { id: 'CARD-09', title: '前起落架时寿件拆换', zone: '前起落架', revision: 'R7', estimated: 3.2, dependencies: ['CARD-04'], tolerance: '剩余循环 ≥ 500', evidence: '件号照片 + 履历页 + 称重记录', witness: '检验员', status: '执行中', measurement: '', finding: '', stage: '适航签署' }
  ] as WorkCard[]
};

const mockBaseQuery: BaseQueryFn = async (arg) => {
  await new Promise((resolve) => setTimeout(resolve, 180));
  if (typeof arg === 'string' && arg === 'package') return { data: packageData };
  if (typeof arg === 'object' && arg !== null && 'url' in arg) {
    const request = arg as { url: string };
    if (request.url === 'package') return { data: packageData };
  }
  return { error: { status: 404, data: 'Not found' } };
};

export const maintenanceApi = createApi({
  reducerPath: 'maintenanceApi',
  baseQuery: mockBaseQuery,
  tagTypes: ['Package', 'LifeServer'],
  endpoints: (builder) => ({
    getWorkPackage: builder.query<typeof packageData, void>({
      query: () => 'package',
      providesTags: ['Package']
    }),
    submitCard: builder.mutation<{ accepted: boolean; revision: number }, { cardId: string; expectedRevision: number; measurement: string; finding: string }>({
      queryFn: async (payload) => {
        await new Promise((resolve) => setTimeout(resolve, 240));
        if (payload.expectedRevision !== packageData.serverRevision) {
          return { error: { status: 409, data: { message: '版本冲突：服务器已有更新，请刷新后重试。' } } };
        }
        return { data: { accepted: true, revision: packageData.serverRevision + 1 } };
      },
      invalidatesTags: ['Package']
    }),

    /** 服务端寿命账当前态（占用锁 / 冲突留痕）；返回深拷贝，缓存冻结不影响服务端状态 */
    getLifeServer: builder.query<LifeServerState, void>({
      queryFn: async () => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return {
          data: {
            revision: server.revision,
            airframeCycles: server.airframeCycles,
            parts: cloneParts(server.parts),
            conflicts: server.conflicts.map((item) => ({ ...item })),
            locks: [...inflightLocks.entries()].map(([position, lock]) => ({ position, holder: lock.holder, eventId: lock.eventId }))
          }
        };
      },
      providesTags: ['LifeServer']
    }),

    /**
     * 时寿件拆换：
     * 1) 同事件号 -> 幂等返回（防重复重试产生双账）
     * 2) 同位置在途占用 -> 先到占用，后到 409 并留冲突
     * 3) 旧件拆下固化消耗、新件装机冻结当前机身循环
     */
    submitReplacement: builder.mutation<ReplacementResult, ReplacementPayload>({
      queryFn: async (payload) => {
        await new Promise((resolve) => setTimeout(resolve, 420));
        try {
          const replayed = idempotency.get(payload.eventId);
          if (replayed) return { data: { ...replayed, idempotent: true } };

          const holder = inflightLocks.get(payload.position);
          if (holder) {
            const conflict: LifeConflict = {
              eventId: payload.eventId,
              heldBy: holder.holder,
              message: `${payload.position} 已被 ${holder.holder} 的拆换（${holder.eventId}）占用，本提交（${payload.eventId}）记为冲突`,
              time: now()
            };
            server.conflicts = [conflict, ...server.conflicts].slice(0, 20);
            return { error: { status: 409, data: { message: conflict.message, heldBy: holder.holder, conflict } } };
          }

          inflightLocks.set(payload.position, { holder: payload.actor, eventId: payload.eventId });
          await new Promise((resolve) => setTimeout(resolve, 260));
          try {
            if (payload.forceFailure) {
              return { error: { status: 500, data: { message: '写入失败：服务端暂不可用，草稿已保留，可按原事件号重试。' } } };
            }
            if (payload.expectedRevision !== server.revision) {
              return { error: { status: 409, data: { message: `寿命账已被他人更新（本地基线 R${payload.expectedRevision} / 服务器 R${server.revision}），请刷新后重算。` } } };
            }

            const found = server.parts.find((part) => part.id === payload.removedPartId && part.status === '装机');
            if (!found) {
              return { error: { status: 409, data: { message: `${payload.removedPartId} 已不是当前装机件，可能已被他人拆换，请刷新寿命账。` } } };
            }
            // COW：写入时复制，避免与已进入 RTK 缓存（被冻结）的查询结果共享引用
            const removed: LifePart = { ...found, events: found.events.map((event) => ({ ...event })) };

            // 拆下：按当前机身循环固化本段消耗
            const consumed = payload.airframeCycles - (removed.installedAtCycle ?? payload.airframeCycles);
            removed.status = '已拆';
            removed.removedAtCycle = payload.airframeCycles;
            removed.frozenConsumed = consumed;
            removed.events.push({
              eventId: `${payload.eventId}-OFF`, kind: '拆下', cardId: payload.cardId, actor: payload.actor,
              airframeCycles: payload.airframeCycles, consumed, time: `${new Date().toISOString().slice(0, 10)} ${now()}`
            });

            // 装机：冻结机身循环
            partSeq += 1;
            const newPart: LifePart = {
              id: `LLP-NLG-${String(partSeq).padStart(2, '0')}`,
              pn: payload.newPartNumber, sn: payload.newSerial, name: removed.name, position: payload.position,
              lifeLimit: payload.newLifeLimit, startingUsed: 0, status: '装机',
              installedAtCycle: payload.airframeCycles,
              events: [
                { eventId: payload.eventId, kind: '装机', cardId: payload.cardId, actor: payload.actor, airframeCycles: payload.airframeCycles, time: `${new Date().toISOString().slice(0, 10)} ${now()}` }
              ]
            };
            server.parts = [newPart, ...server.parts.map((part) => (part.id === removed.id ? removed : part))];
            server.revision += 1;

            const result: ReplacementResult = {
              accepted: true,
              revision: server.revision,
              event: {
                eventId: payload.eventId,
                removedPartId: removed.id,
                consumed,
                newPart,
                airframeCycles: payload.airframeCycles,
                time: now()
              }
            };
            idempotency.set(payload.eventId, result);
            return { data: result };
          } finally {
            inflightLocks.delete(payload.position);
          }
        } finally {
          // 锁在 finally 中保证释放；500/409 后草稿仍可按原事件号重试
        }
      },
      invalidatesTags: ['LifeServer']
    })
  })
});

export const { useGetWorkPackageQuery, useSubmitCardMutation, useGetLifeServerQuery, useSubmitReplacementMutation } = maintenanceApi;
