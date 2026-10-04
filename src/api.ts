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
    { id: 'CARD-08', title: '重复缺陷趋势复核', zone: '全机', revision: 'R7', estimated: 1.0, dependencies: ['CARD-02', 'CARD-03'], tolerance: '无新增重复缺陷', evidence: '近 3 次记录', witness: '质量经理', status: '执行中', measurement: '发现 2 次压力偏低', finding: '移交可靠性分析', stage: '放行签署' }
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

// ---- 时寿件寿命账 ----
// 装机冻结机身循环，拆下固化消耗；循环/履历变化只重算当前装机件，已拆件保留原值。
export type LifePartStatus = '在装' | '已拆';
export type LifeEventType = '装机' | '拆下' | '循环更新' | '履历修正';
export type LifeEventStatus = '已提交' | '冲突' | '失败' | '草稿';

export type LifePart = {
  id: string;
  partNumber: string;
  serial: string;
  name: string;
  location: string;
  status: LifePartStatus;
  installCycles: number; // 装机冻结机身循环（基准，不随后续循环变化）
  installDate: string;
  limitCycles: number; // 寿命限制（循环）
  currentCycles: number; // 当前消耗：在装件随循环重算，已拆件冻结
  remainingCycles: number; // 剩余循环 = 寿命限制 - 当前消耗
  removeCycles?: number; // 拆下固化消耗（拆下时机身循环 - 装机冻结循环）
  removeDate?: string;
  removeReason?: string;
  workCardId: string; // 关联工卡
};

export type LifeEventRecord = {
  eventNo: string; // 事件号（幂等键，重试沿用原事件号）
  type: LifeEventType;
  partId?: string;
  cycles: number; // 事件时机身循环
  date: string;
  technician: string;
  status: LifeEventStatus;
  message?: string;
  duplicate?: boolean; // 防重复：事件号已处理
  payload?: {
    partId?: string;
    reason?: string;
    partNumber?: string;
    serial?: string;
    name?: string;
    location?: string;
    limitCycles?: number;
    workCardId?: string;
  };
};

export const lifeData = {
  fuselageCycles: 12840,
  parts: [
    { id: 'LLP-001', partNumber: '2345678-01', serial: 'SN-1001', name: '前起落架减震支柱', location: '前起落架', status: '在装', installCycles: 8200, installDate: '2024-03-15', limitCycles: 12000, currentCycles: 4640, remainingCycles: 7360, workCardId: 'CARD-04' },
    { id: 'LLP-002', partNumber: '3456789-02', serial: 'SN-2002', name: '前起落架扭力臂', location: '前起落架', status: '在装', installCycles: 9500, installDate: '2024-06-20', limitCycles: 15000, currentCycles: 3340, remainingCycles: 11660, workCardId: 'CARD-04' },
    { id: 'LLP-003', partNumber: '4567890-03', serial: 'SN-3003', name: '前起落架阻力臂', location: '前起落架', status: '已拆', installCycles: 7000, installDate: '2023-01-10', limitCycles: 6000, currentCycles: 4320, remainingCycles: 1680, removeCycles: 4320, removeDate: '2026-09-28', removeReason: '定检拆换，寿命到期', workCardId: 'CARD-04' },
    { id: 'LLP-004', partNumber: '5678901-04', serial: 'SN-4004', name: '前起落架作动筒', location: '前起落架', status: '在装', installCycles: 11000, installDate: '2025-11-05', limitCycles: 18000, currentCycles: 1840, remainingCycles: 16160, workCardId: 'CARD-04' }
  ] as LifePart[]
};

// 服务器端寿命账模拟状态
const processedLifeEvents = new Set<string>(); // 已处理事件号（幂等防重复）
const occupiedParts = new Map<string, string>(); // 件占用：partId -> eventNo（先到占用）

export type SubmitPartEventResult = {
  accepted: boolean;
  duplicate?: boolean;
  eventNo: string;
  type: LifeEventType;
  partId?: string;
  cycles: number;
  message?: string;
};

export const maintenanceApi = createApi({
  reducerPath: 'maintenanceApi',
  baseQuery: mockBaseQuery,
  tagTypes: ['Package', 'Life'],
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
    submitPartEvent: builder.mutation<SubmitPartEventResult, { eventNo: string; type: LifeEventType; partId?: string; cycles: number; technician: string; forceFail?: boolean; reason?: string }>({
      queryFn: async (payload) => {
        await new Promise((resolve) => setTimeout(resolve, 260));
        // 防重复：事件号已处理则返回原结果，不重复入账
        if (processedLifeEvents.has(payload.eventNo)) {
          return { data: { accepted: true, duplicate: true, eventNo: payload.eventNo, type: payload.type, partId: payload.partId, cycles: payload.cycles, message: '事件号已处理，返回原结果（防重复入账）' } };
        }
        // 并发占用：同一件拆换先到占用，后到留冲突
        if (payload.type === '拆下' && payload.partId) {
          const occupier = occupiedParts.get(payload.partId);
          if (occupier && occupier !== payload.eventNo) {
            return { error: { status: 409, data: { message: `该件已被占用（事件号 ${occupier}），请刷新后重试。`, conflictEventNo: occupier } } };
          }
        }
        // 模拟写入失败：保留草稿，按原事件号重试
        if (payload.forceFail) {
          return { error: { status: 500, data: { message: '写入失败：服务器暂时不可用，草稿已保留，请按原事件号重试。' } } };
        }
        // 处理事件并入账
        processedLifeEvents.add(payload.eventNo);
        if (payload.type === '拆下' && payload.partId) {
          occupiedParts.set(payload.partId, payload.eventNo);
        }
        return { data: { accepted: true, eventNo: payload.eventNo, type: payload.type, partId: payload.partId, cycles: payload.cycles } };
      },
      invalidatesTags: ['Life']
    })
  })
});

export const { useGetWorkPackageQuery, useSubmitCardMutation, useSubmitPartEventMutation } = maintenanceApi;
