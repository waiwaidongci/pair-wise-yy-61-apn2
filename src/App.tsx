import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Divider,
  Field,
  FluentProvider,
  Input,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  Spinner,
  Tab,
  TabList,
  Tag,
  Text,
  Textarea,
  Tooltip,
  webLightTheme
} from '@fluentui/react-components';
import {
  AlertRegular,
  ArrowDownloadRegular,
  ArrowSwapRegular,
  ArrowSyncRegular,
  BookOpenRegular,
  CheckmarkCircleRegular,
  ClipboardTaskListLtrRegular,
  CloudArrowUpRegular,
  CloudOffRegular,
  DocumentBulletListRegular,
  GaugeRegular,
  HistoryRegular,
  LockClosedRegular,
  NavigationRegular,
  PeopleRegular,
  SaveRegular,
  WarningRegular
} from '@fluentui/react-icons';
import {
  useGetWorkPackageQuery,
  useSubmitCardMutation,
  useGetLifeServerQuery,
  useSubmitReplacementMutation,
  type LifePart,
  type ReplacementPayload
} from './api';
import {
  adjustAirframeCycles,
  applyReplacement,
  authorizeOverride,
  clearLifeMessage,
  correctLifeHistory,
  discardLifeDraft,
  LIFE_MIN_REMAINING,
  partRemaining,
  partSegmentUsed,
  partTotalUsed,
  recordLifeConflict,
  reconcileLifeServer,
  refreshVersion,
  releasePackage,
  retryLifeDraftAttempt,
  saveLifeDraft,
  selectCard,
  setConflict,
  setLifeMessage,
  signStage,
  syncLifeServer,
  toggleOffline,
  updateCard,
  type RootState
} from './store';

type NavItem = { path: string; label: string; icon: ReactNode };

const TECHNICIANS = ['宋杰 · 机械', '周凯 · 机械'];

function Shell({ children }: { children: ReactNode }) {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useDispatch();
  const nav: NavItem[] = [
    { path: '/', label: '工作包总览', icon: <ClipboardTaskListLtrRegular /> },
    { path: '/execution', label: '工卡执行', icon: <BookOpenRegular /> },
    { path: '/life', label: '时寿件寿命账', icon: <ArrowSwapRegular /> },
    { path: '/release', label: '放行审阅', icon: <LockClosedRegular /> },
    { path: '/audit', label: '审计与差异', icon: <HistoryRegular /> }
  ];
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon"><NavigationRegular /></div>
          <div><strong>航空定检执行台</strong><span>Maintenance Work Package</span></div>
        </div>
        <div className="aircraft-chip"><span>B-7891</span><strong>B737-800</strong><Badge appearance="tint" color="brand">48A 定检</Badge></div>
        <div className="header-spacer" />
        <button className={`sync-status ${state.offline ? 'offline' : ''}`} onClick={() => dispatch(toggleOffline())}>
          {state.offline ? <CloudOffRegular /> : <CloudArrowUpRegular />}<span>{state.offline ? '离线暂存' : `已同步 R${state.syncVersion}`}</span>
        </button>
        <div className="user-chip"><span>执行人员</span><strong>宋杰 · 机械</strong></div>
      </header>
      <div className="shell-grid">
        <aside className="side-nav">
          <div className="package-summary">
            <span>工作包</span><strong>WP-B7891-04</strong><small>上海浦东 · H3 机库</small>
            <div><ProgressBar value={0.58} /><span>58% 工卡完成</span></div>
          </div>
          <nav>{nav.map((item) => <NavLink end={item.path === '/'} key={item.path} to={item.path}>{item.icon}<span>{item.label}</span></NavLink>)}</nav>
          <div className="side-status"><WarningRegular /><div><strong>{state.cards.filter((card) => card.status === '待授权').length} 项待授权</strong><span>放行前必须处理</span></div></div>
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><small>{eyebrow}</small><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{actions}</div></div>;
}

function Overview() {
  const state = useSelector((root: RootState) => root.maintenance);
  const { data } = useGetWorkPackageQuery();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const completed = state.cards.filter((card) => card.status === '已完成').length;
  const blockers = state.cards.filter((card) => card.status === '待授权');
  return (
    <div className="page">
      <PageHeading eyebrow="WP-B7891-04 / 48A CHECK" title="工作包总览" description="监控工卡依赖、阶段签署、超差项目和放行门禁。" actions={<><Button appearance="secondary" icon={<ArrowDownloadRegular />}>导出进度</Button><Button appearance="primary" icon={<NavigationRegular />} onClick={() => navigate('/execution')}>继续执行</Button></>} />
      {blockers.length > 0 && <MessageBar intent="warning" className="top-message"><MessageBarBody><strong>放行阻断：</strong>{blockers.map((card) => `${card.id} ${card.title}`).join('、')} 等待授权人员处理。</MessageBarBody></MessageBar>}
      <div className="metrics-grid">
        {[
          ['工卡完成度', `${completed} / ${state.cards.length}`, `${Math.round(completed / state.cards.length * 100)}%`, 'green'],
          ['已记录工时', '18.6 h', '计划 20.5 h', 'blue'],
          ['机身循环（寿命账）', `${state.airframeCycles} FC`, state.baseline ? `放行基线冻结 @${state.baseline.airframeCycles}` : '装机冻结 / 拆下固化', 'amber'],
          ['待签署阶段', String(state.signatures.filter((item) => item.status === '待签署' || item.status === '已失效').length), '放行前完成', 'red']
        ].map((item) => <div className="metric-card" key={item[0]}><span>{item[0]}</span><strong>{item[1]}</strong><small className={item[3]}>{item[2]}</small></div>)}
      </div>
      <div className="overview-grid">
        <section className="panel task-panel">
          <div className="panel-head"><div><h2>关键工卡与依赖</h2><span>按执行依赖和风险排序；时寿件拆换工卡与寿命账挂接</span></div><Badge appearance="tint">{data?.revision ?? 'WP R7'}</Badge></div>
          {state.cards.map((card, index) => (
            <button key={card.id} className={`task-row ${state.activeCardId === card.id ? 'active' : ''}`} onClick={() => { dispatch(selectCard(card.id)); navigate(card.id === 'CARD-09' ? '/life' : '/execution'); }}>
              <span className={`task-index ${card.status === '已完成' ? 'done' : card.status === '待授权' ? 'blocked' : ''}`}>{card.status === '已完成' ? <CheckmarkCircleRegular /> : index + 1}</span>
              <span className="task-main"><strong>{card.id} · {card.title}</strong><small>{card.zone} · 依赖 {card.dependencies.length ? card.dependencies.join('、') : '无'} · 计划 {card.estimated}h</small></span>
              <Tag appearance="outline" size="small">{card.stage}</Tag>
              <Badge appearance="tint" color={card.status === '已完成' ? 'success' : card.status === '待授权' ? 'danger' : card.status === '执行中' ? 'brand' : 'informative'}>{card.status}</Badge>
            </button>
          ))}
        </section>
        <aside className="overview-side">
          <section className="panel stage-panel"><div className="panel-head"><h2>阶段签字</h2><PeopleRegular /></div>{state.signatures.map((item) => <div className="signature-row" key={item.stage}><span className={item.status === '已签署' ? 'signed' : item.status === '已失效' ? 'invalid' : ''}>{item.status === '已签署' ? <CheckmarkCircleRegular /> : item.stage.slice(0, 1)}</span><div><strong>{item.stage}签署{item.status === '已失效' ? '（已失效）' : ''}</strong><small>{item.actor} · {item.time}</small></div></div>)}</section>
          <section className="panel dependency-panel"><div className="panel-head"><h2>依赖路径</h2><GaugeRegular /></div><div className="dependency-graph"><span>CARD-04 核对</span><i /><span className="critical">CARD-09 拆换</span><i /><span>寿命账重算</span><i /><span>适航/放行签署</span></div></section>
        </aside>
      </div>
    </div>
  );
}

function Execution() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useDispatch();
  const { data } = useGetWorkPackageQuery();
  const navigate = useNavigate();
  const card = state.cards.find((item) => item.id === state.activeCardId) ?? state.cards[0];
  const [measurement, setMeasurement] = useState(card.measurement);
  const [finding, setFinding] = useState(card.finding);
  const [consumable, setConsumable] = useState('');
  const [witness, setWitness] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [submitCard] = useSubmitCardMutation();
  useEffect(() => { setMeasurement(card.measurement); setFinding(card.finding); }, [card.id, card.measurement, card.finding]);
  const toleranceIssue = card.id === 'CARD-03' && Number.parseFloat(measurement) < 2850;
  const dependenciesMet = card.dependencies.every((dependency) => state.cards.find((item) => item.id === dependency)?.status === '已完成');
  const complete = async () => {
    if (!dependenciesMet) {
      dispatch(setConflict(`前置工卡 ${card.dependencies.join('、')} 尚未完成。`));
      return;
    }
    if (toleranceIssue) {
      dispatch(setConflict('测量值超出容差，必须由授权人员处理。'));
      return;
    }
    if (!witness) {
      dispatch(setConflict('关键步骤必须完成见证确认。'));
      return;
    }
    if (state.syncVersion !== state.serverVersion) {
      dispatch(setConflict('检测到冲突提交：本地版本与服务器版本不一致，请刷新后重试。'));
      return;
    }
    const result = await submitCard({ cardId: card.id, expectedRevision: state.serverVersion, measurement, finding }).unwrap().catch((error) => {
      dispatch(setConflict(error.data?.message ?? '提交失败，请重试。'));
      return null;
    });
    if (result?.accepted) {
      dispatch(updateCard({ measurement, finding, status: '已完成' }));
      dispatch(setConflict(''));
    }
  };
  return (
    <div className="page">
      <PageHeading eyebrow={`${card.id} / ${card.stage}`} title={card.title} description={`${card.zone} · 工卡版本 ${data?.revision ?? 'R7'} · 预计 ${card.estimated} 小时`} actions={<><Button appearance="secondary" icon={<ArrowSyncRegular />} onClick={() => dispatch(toggleOffline())}>{state.offline ? '恢复在线' : '离线暂存'}</Button>{card.id === 'CARD-09'
        ? <Button appearance="primary" icon={<ArrowSwapRegular />} onClick={() => navigate('/life')}>前往寿命账拆换</Button>
        : <Button appearance="primary" icon={<CheckmarkCircleRegular />} onClick={complete}>完成并提交</Button>}</>} />
      {card.id === 'CARD-09' && (
        <MessageBar intent="info" className="top-message">
          <MessageBarBody>本工卡为前起落架时寿件拆换：装机冻结机身循环、拆下固化消耗，拆换结果回写后自动关闭工卡，并使适航/放行签字失效待重签。</MessageBarBody>
          <Button appearance="transparent" size="small" onClick={() => navigate('/life')}>打开寿命账</Button>
        </MessageBar>
      )}
      {state.conflictMessage && <MessageBar intent="error" className="top-message"><MessageBarBody><strong>提交被阻断：</strong>{state.conflictMessage}</MessageBarBody><Button appearance="secondary" size="small" onClick={() => dispatch(refreshVersion())}>刷新版本</Button></MessageBar>}
      <div className="execution-grid">
        <section className="panel card-editor">
          <div className="panel-head"><div><h2>工卡执行内容</h2><span>执行人员必须记录关键数据及证据</span></div><Badge appearance="tint" color={card.status === '待授权' ? 'danger' : 'brand'}>{card.status}</Badge></div>
          <div className="procedure-block">
            <h3>施工步骤</h3>
            {['确认飞机断电并设置 DO NOT OPERATE 警告牌。', '连接校准合格的测试设备，按 AMM 29-10-00 执行压力保持测试。', '记录稳定压力值，检查 10 分钟内压降。', '恢复系统构型，目视检查渗漏并上传证据。'].map((step, index) => <label key={step} className="procedure-step"><Checkbox defaultChecked={index < 2} /><span><b>{index + 1}.</b> {step}</span></label>)}
          </div>
          <Divider />
          <div className="form-grid">
            <Field label="测量值" hint={card.tolerance} validationState={toleranceIssue ? 'error' : 'none'} validationMessage={toleranceIssue ? '低于最低接受值 2850 psi' : undefined}><Input value={measurement} onChange={(_, data) => setMeasurement(data.value)} contentBefore={<GaugeRegular />} /></Field>
            <Field label="耗材 / 航材"><Input value={consumable} onChange={(_, data) => setConsumable(data.value)} placeholder="输入件号或耗材批次" /></Field>
            <Field label="发现与处置" className="wide-field"><Textarea value={finding} onChange={(_, data) => setFinding(data.value)} resize="vertical" placeholder="正常或填写缺陷、处置措施" /></Field>
            <Field label="证据附件" className="wide-field"><div className="upload-zone"><CloudArrowUpRegular /><strong>拖入照片、测试记录或报告</strong><span>已关联 3 个证据 · 支持 JPG / PDF / TXT</span></div></Field>
          </div>
          <label className="witness-check"><Checkbox checked={witness} onChange={(_, data) => setWitness(Boolean(data.checked))} /><span><strong>见证人已现场确认</strong><small>要求：{card.witness}</small></span></label>
        </section>
        <aside className="execution-side">
          <section className="panel card-meta"><div className="panel-head"><h2>工卡信息</h2><DocumentBulletListRegular /></div><dl><div><dt>容差</dt><dd>{card.tolerance}</dd></div><div><dt>证据要求</dt><dd>{card.evidence}</dd></div><div><dt>前置条件</dt><dd>{card.dependencies.length ? card.dependencies.join('、') : '无'}</dd></div><div><dt>阶段签署</dt><dd>{card.stage}</dd></div></dl></section>
          {card.status === '待授权' && <section className="panel override-panel"><WarningRegular /><h3>超差项目等待授权</h3><p>原始测量值已保留。授权人员可以批准工程指令、退回复测或要求停场处理。</p><Button appearance="primary" onClick={() => setOverrideOpen(true)}>授权处理</Button></section>}
          <section className="panel evidence-panel"><div className="panel-head"><h2>证据附件</h2><Badge appearance="tint">3 项</Badge></div>{['IMG_20260929_0904.jpg', '液压测试原始记录.pdf', '见证签字单_宋杰.pdf'].map((file, index) => <div className="evidence-row" key={file}><DocumentBulletListRegular /><div><strong>{file}</strong><small>{index + 1}.8 MB · 09:1{index}</small></div><Button size="small" appearance="subtle">预览</Button></div>)}</section>
        </aside>
      </div>
      <Dialog open={overrideOpen} onOpenChange={(_, data) => setOverrideOpen(data.open)}><DialogSurface><DialogBody><DialogTitle>超差授权处理</DialogTitle><DialogContent>批准后将在工卡中记录授权人、工程指令编号与处置依据，原始测量值不会被覆盖。<Field label="工程指令编号" required className="dialog-field"><Input defaultValue="EO-2026-1147" /></Field><Field label="授权依据" required className="dialog-field"><Textarea defaultValue="按 AMM 容差分析并经工程部门确认，允许执行复测与系统恢复。" /></Field></DialogContent><DialogActions><Button appearance="secondary" onClick={() => setOverrideOpen(false)}>取消</Button><Button appearance="primary" onClick={() => { dispatch(authorizeOverride()); setOverrideOpen(false); }}>确认授权</Button></DialogActions></DialogBody></DialogSurface></Dialog>
    </div>
  );
}

// ===== 时寿件寿命账 =====

type LifeRowProps = {
  part: LifePart;
  cycle: number;
  baselineUsed?: number;
  baselineRemaining?: number;
  onCorrect: (part: LifePart) => void;
};

function LifeLedgerRow({ part, cycle, baselineUsed, baselineRemaining, onCorrect }: LifeRowProps) {
  const [open, setOpen] = useState(false);
  const installed = part.status === '装机';
  const segment = partSegmentUsed(part, cycle);
  const totalUsed = partTotalUsed(part, cycle);
  const remaining = partRemaining(part, cycle);
  const pct = Math.min(100, Math.round((totalUsed / part.lifeLimit) * 100));
  const tone = !installed ? 'informative' : remaining < LIFE_MIN_REMAINING ? 'danger' : remaining < LIFE_MIN_REMAINING * 2 ? 'warning' : 'success';
  return (
    <div className={`life-row ${installed ? '' : 'removed'}`}>
      <button className="life-row-head" onClick={() => setOpen((value) => !value)}>
        <span className={`life-caret ${open ? 'open' : ''}`}>›</span>
        <span className="life-id"><strong>{part.id}</strong><small>{part.name} · {part.position}</small></span>
        <span className="life-pn"><small>PN / SN</small><strong>{part.pn} / {part.sn}</strong></span>
        <span className="life-state"><small>{installed ? `装机冻结 @${part.installedAtCycle}` : `拆下固化 @${part.removedAtCycle}`}</small><strong>{installed ? `${segment} FC` : `本段 ${part.frozenConsumed} FC（已固化）`}</strong></span>
        <span className="life-remain" data-tone={tone}>
          <small>{installed ? `累计已用 ${totalUsed} / 寿限 ${part.lifeLimit}` : `已用 ${part.startingUsed + (part.frozenConsumed ?? 0)} / 寿限 ${part.lifeLimit}`}</small>
          <strong>{installed ? `剩余 ${remaining} FC` : '已拆 · 原值保留'}</strong>
          {installed && <ProgressBar value={pct / 100} color={tone === 'danger' ? 'error' : tone === 'warning' ? 'brand' : 'success'} />}
        </span>
        <Badge appearance="tint" color={installed ? tone === 'danger' ? 'danger' : 'brand' : 'informative'}>{part.status}</Badge>
        {installed && <Button size="small" appearance="subtle" onClick={(event) => { event.stopPropagation(); onCorrect(part); }}>履历修正</Button>}
      </button>
      {open && (
        <div className="life-detail">
          <div className="life-event-list">
            <div className="life-event-head"><span>事件号</span><span>类型</span><span>工卡</span><span>机身循环</span><span>本段消耗</span><span>执行人 / 时间</span></div>
            {part.events.map((event) => (
              <div className="life-event-row" key={event.eventId}><span>{event.eventId}</span><span><Tag size="extra-small" appearance={event.kind === '装机' ? 'brand' : 'outline'}>{event.kind}</Tag></span><span>{event.cardId}</span><span>{event.airframeCycles}</span><span>{event.consumed != null ? `${event.consumed} FC` : '—'}</span><span>{event.actor} · {event.time}</span></div>
            ))}
          </div>
          {!installed && <small className="frozen-note">拆下后消耗已固化为 {part.frozenConsumed} FC；机身循环或履历后续变化不再重算本件。</small>}
          {installed && baselineRemaining != null && (
            <small className="drift-note">放行基线：冻结时已用 {baselineUsed} / 剩余 {baselineRemaining} FC；与当前账差 {remaining - baselineRemaining} FC（基线只读，不随当前账改动）。</small>
          )}
        </div>
      )}
    </div>
  );
}

function LifeLedger() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useDispatch();
  const { data: serverState, refetch } = useGetLifeServerQuery(undefined, { pollingInterval: 2500 });
  const [submitReplacement] = useSubmitReplacementMutation();

  const installedParts = state.lifeParts.filter((part) => part.status === '装机');
  const [removedPartId, setRemovedPartId] = useState(installedParts[0]?.id ?? '');
  useEffect(() => {
    if (!installedParts.some((part) => part.id === removedPartId)) setRemovedPartId(installedParts[0]?.id ?? '');
  }, [state.lifeParts]);
  const removedPart = installedParts.find((part) => part.id === removedPartId) ?? installedParts[0];

  const [actor, setActor] = useState(TECHNICIANS[0]);
  const [newPn, setNewPn] = useState('NLG-BAR-4410R');
  const [newSn, setNewSn] = useState('SN-60018');
  const [newLimit, setNewLimit] = useState('12000');
  const [cycleDelta, setCycleDelta] = useState('1');
  const [cycleReason, setCycleReason] = useState('航后循环读数入账');
  const [simulateFail, setSimulateFail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [correctTarget, setCorrectTarget] = useState<LifePart | null>(null);
  const [correctUsed, setCorrectUsed] = useState('');
  const [correctLimit, setCorrectLimit] = useState('');

  useEffect(() => () => { dispatch(clearLifeMessage()); }, [dispatch]);
  useEffect(() => {
    if (serverState) dispatch(syncLifeServer({ conflicts: serverState.conflicts }));
  }, [serverState, dispatch]);

  const refreshLife = async () => {
    const result = await refetch();
    if (result.data) {
      dispatch(reconcileLifeServer({
        revision: result.data.revision,
        airframeCycles: result.data.airframeCycles,
        parts: result.data.parts,
        conflicts: result.data.conflicts
      }));
    }
  };

  const nextEventId = () => `EV-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;

  const buildPayload = (eventId: string, tech: string, forceFailure = false): ReplacementPayload | null => {
    if (!removedPart) return null;
    const limit = Number.parseInt(newLimit, 10);
    if (!newPn.trim() || !newSn.trim() || !Number.isFinite(limit) || limit <= 0) return null;
    return {
      eventId,
      cardId: 'CARD-09',
      removedPartId: removedPart.id,
      position: removedPart.position,
      newPartNumber: newPn.trim(),
      newSerial: newSn.trim(),
      newLifeLimit: limit,
      airframeCycles: state.airframeCycles,
      actor: tech,
      expectedRevision: state.lifeRevision,
      forceFailure
    };
  };

  const runSubmission = async (payload: ReplacementPayload, opts: { concurrent?: boolean } = {}) => {
    // 离线：不打服务端，直接保留草稿
    if (state.offline) {
      dispatch(saveLifeDraft({ draft: { ...payload, reason: '离线暂存', savedAt: new Date().toISOString(), attempts: 1 } }));
      return;
    }
    try {
      const result = await submitReplacement(payload).unwrap();
      dispatch(applyReplacement({ result, cardId: payload.cardId, actor: payload.actor }));
    } catch (error: unknown) {
      const err = error as { status?: number; data?: { message?: string; heldBy?: string } };
      if (err.status === 409 && err.data?.heldBy) {
        // 后到者：留冲突，不覆盖已占用件，不生成草稿
        dispatch(recordLifeConflict({
          conflict: {
            eventId: payload.eventId,
            heldBy: String(err.data.heldBy),
            message: err.data.message ?? `${payload.position} 已被他人占用`,
            time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
          }
        }));
      } else if (err.status === 409) {
        // 乐观锁/装机状态过期：不留草稿，提示刷新对账后重试
        dispatch(setLifeMessage({ intent: 'error', text: `${err.data?.message ?? '版本冲突'}（事件号 ${payload.eventId}，未入账；请刷新寿命账后再提交）` }));
      } else {
        // 500 / 网络错误：保留草稿，按原事件号重试（幂等）
        dispatch(saveLifeDraft({ draft: { ...payload, reason: '写入失败', savedAt: new Date().toISOString(), attempts: 1 } }));
      }
    } finally {
      if (!opts.concurrent) setSubmitting(false);
      refetch();
    }
  };

  const submit = () => {
    if (submitting || !removedPart) return;
    const payload = buildPayload(nextEventId(), actor, simulateFail);
    if (!payload) return;
    if (!newPn.trim() || !newSn.trim()) return;
    setSubmitting(true);
    void runSubmission(payload);
  };

  /** 两名技术员同时提交同一件拆换：先到占用，后到留冲突 */
  const submitConcurrent = async () => {
    if (submitting || !removedPart) return;
    if (!newPn.trim() || !newSn.trim()) return;
    setSubmitting(true);
    const idA = nextEventId();
    const idB = nextEventId();
    const payloadA = buildPayload(idA, TECHNICIANS[0], false);
    const payloadB = buildPayload(idB, TECHNICIANS[1], false);
    if (!payloadA || !payloadB) { setSubmitting(false); return; }
    await Promise.allSettled([
      runSubmission(payloadA, { concurrent: true }),
      new Promise<void>((r) => { setTimeout(r, 120); }).then(() => runSubmission(payloadB, { concurrent: true }))
    ]);
    setSubmitting(false);
  };

  const retryDraft = async (draftId: string) => {
    const draft = state.lifeDrafts.find((item) => item.eventId === draftId);
    if (!draft || state.offline) return;
    dispatch(retryLifeDraftAttempt(draftId));
    // 原事件号重试（防重复）；expectedRevision 跟随刷新后的当前基线
    await runSubmission({ ...draft, forceFailure: false, expectedRevision: state.lifeRevision });
  };

  const openCorrect = (part: LifePart) => {
    setCorrectTarget(part);
    setCorrectUsed(String(part.startingUsed));
    setCorrectLimit(String(part.lifeLimit));
  };

  const baselinePart = (partId: string) => state.baseline?.parts.find((item) => item.partId === partId);
  const shortestRemaining = Math.min(...installedParts.map((part) => partRemaining(part, state.airframeCycles)));
  const invalidSigs = state.signatures.filter((item) => item.status === '已失效');

  return (
    <div className="page life-page">
      <PageHeading
        eyebrow="LIFE LEDGER / NLG LIMITED-LIFE PARTS"
        title="前起落架时寿件寿命账"
        description="工卡拆换 → 装机冻结机身循环、拆下固化消耗；机身循环账、件履历账、放行基线各算各的。"
        actions={<><Button appearance="secondary" icon={<ArrowSyncRegular />} onClick={() => void refreshLife()}>刷新对账</Button><Button appearance="secondary" icon={<CloudOffRegular />} onClick={() => dispatch(toggleOffline())}>{state.offline ? '恢复在线' : '离线暂存'}</Button></>}
      />

      {state.lifeMessage && (
        <MessageBar className="top-message" intent={state.lifeMessage.intent}>
          <MessageBarBody>{state.lifeMessage.text}</MessageBarBody>
          <Button appearance="transparent" size="small" onClick={() => dispatch(clearLifeMessage())}>关闭</Button>
        </MessageBar>
      )}
      {state.offline && <MessageBar intent="warning" className="top-message"><MessageBarBody>离线中：拆换提交只保留草稿，恢复在线后按原事件号提交（服务端幂等，防重复）。</MessageBarBody></MessageBar>}
      {state.lifeDrafts.length > 0 && (
        <MessageBar intent="error" className="top-message"><MessageBarBody><strong>有待重试草稿 {state.lifeDrafts.length} 笔</strong>（写入失败或离线暂存，原事件号保留）。</MessageBarBody></MessageBar>
      )}

      <div className="life-books">
        <div className="book-card">
          <small>机身循环账</small>
          <strong>{state.airframeCycles} FC</strong>
          <span>循环变化只重算当前装机件</span>
          <div className="book-actions">
            <Input size="small" value={cycleDelta} onChange={(_, data) => setCycleDelta(data.value)} style={{ width: 74 }} contentBefore="Δ" />
            <Button size="small" appearance="primary" disabled={state.released} onClick={() => {
              const delta = Number.parseInt(cycleDelta, 10);
              if (Number.isFinite(delta) && delta !== 0) dispatch(adjustAirframeCycles({ delta, actor, reason: cycleReason || '循环入账' }));
            }}>入账循环</Button>
          </div>
          <input className="book-reason" value={cycleReason} onChange={(event) => setCycleReason(event.target.value)} placeholder="读数依据" />
        </div>
        <div className="book-card">
          <small>件履历账</small>
          <strong>R{state.lifeRevision} · {state.lifeParts.length} 件</strong>
          <span>{installedParts.length} 件装机 / {state.lifeParts.length - installedParts.length} 件已拆</span>
          <span className={shortestRemaining < LIFE_MIN_REMAINING ? 'danger-text' : ''}>装机最短剩余 {shortestRemaining} FC（门槛 {LIFE_MIN_REMAINING}）</span>
        </div>
        <div className={`book-card ${state.baseline ? 'locked' : ''}`}>
          <small>放行基线</small>
          <strong>{state.baseline ? `R${state.baseline.revision} 已锁定` : '未锁定'}</strong>
          <span>{state.baseline ? `只读快照 @${state.baseline.airframeCycles} FC · ${state.baseline.frozenAt}` : '放行锁定时形成只读快照'}</span>
          {invalidSigs.length > 0 && <span className="danger-text">{invalidSigs.map((item) => item.stage).join('、')}签字已失效待重签</span>}
        </div>
      </div>

      <div className="life-grid">
        <section className="panel life-ledger-panel">
          <div className="panel-head"><div><h2>件履历与计寿</h2><span>装机件按当前循环实时重算；已拆件显示拆下固化原值</span></div><Badge appearance="tint">关联 CARD-09</Badge></div>
          {state.lifeParts.map((part) => (
            <LifeLedgerRow
              key={part.id}
              part={part}
              cycle={state.airframeCycles}
              baselineUsed={baselinePart(part.id)?.used}
              baselineRemaining={baselinePart(part.id)?.remaining}
              onCorrect={openCorrect}
            />
          ))}
        </section>

        <aside className="life-side">
          <section className="panel replacement-panel">
            <div className="panel-head"><h2>时寿件拆换（CARD-09）</h2><ArrowSwapRegular /></div>
            <div className="replace-form">
              <Field label="执行技术员"><select className="life-select" value={actor} onChange={(event) => setActor(event.target.value)}>{TECHNICIANS.map((name) => <option key={name}>{name}</option>)}</select></Field>
              <Field label="拆下件（当前装机）">
                <select className="life-select" value={removedPart?.id ?? ''} onChange={(event) => setRemovedPartId(event.target.value)}>
                  {installedParts.map((part) => <option key={part.id} value={part.id}>{part.id} · {part.name}（剩余 {partRemaining(part, state.airframeCycles)} FC）</option>)}
                </select>
              </Field>
              <Field label="新件件号 PN"><Input value={newPn} onChange={(_, data) => setNewPn(data.value)} /></Field>
              <div className="replace-two"><Field label="新件序号 SN"><Input value={newSn} onChange={(_, data) => setNewSn(data.value)} /></Field><Field label="寿限 FC"><Input type="number" value={newLimit} onChange={(_, data) => setNewLimit(data.value)} /></Field></div>
              <label className="fail-check"><Checkbox checked={simulateFail} onChange={(_, data) => setSimulateFail(Boolean(data.checked))} /><span><strong>模拟服务端写入失败</strong><small>验证：保留草稿 → 关闭此项 → 按原事件号重试</small></span></label>
              <div className="replace-actions">
                <Button appearance="primary" icon={submitting ? <Spinner size="extra-tiny" /> : <CloudArrowUpRegular />} disabled={submitting || state.released} onClick={submit}>提交拆换</Button>
                <Tooltip content="两名技术员同时提交同一件：服务端先到占用，后到 409 并在下方留冲突" relationship="label">
                  <Button appearance="outline" disabled={submitting || state.offline || state.released} onClick={() => void submitConcurrent()}>两人同时提交（演示冲突）</Button>
                </Tooltip>
              </div>
              <small className="replace-note">提交即生成唯一事件号；服务端对事件号幂等，重试不重复入账。装机冻结 @{state.airframeCycles} FC。</small>
            </div>
          </section>

          <section className="panel draft-panel">
            <div className="panel-head"><div><h2>失败草稿</h2><span>按原事件号重试，防重复</span></div><Badge appearance="tint" color={state.lifeDrafts.length ? 'danger' : 'informative'}>{state.lifeDrafts.length}</Badge></div>
            {state.lifeDrafts.length === 0 && <div className="empty-note"><SaveRegular /><span>暂无草稿</span></div>}
            {state.lifeDrafts.map((draft) => (
              <div className="draft-row" key={draft.eventId}>
                <div><strong>{draft.eventId}</strong><small>{draft.actor} · 拆 {draft.removedPartId} · {draft.reason} · 已试 {draft.attempts} 次</small></div>
                <div className="draft-actions">
                  <Button size="small" appearance="primary" disabled={state.offline} onClick={() => void retryDraft(draft.eventId)}>原事件号重试</Button>
                  <Button size="small" appearance="subtle" onClick={() => dispatch(discardLifeDraft(draft.eventId))}>放弃</Button>
                </div>
              </div>
            ))}
          </section>

          <section className="panel lock-panel">
            <div className="panel-head"><div><h2>占用与冲突</h2><span>先到占用，后到留冲突</span></div><Tag size="small">{serverState?.locks.length ?? 0} 在途</Tag></div>
            {(serverState?.locks ?? []).length > 0 && (serverState?.locks ?? []).map((lock) => (
              <div className="lock-row" key={`${lock.position}-${lock.eventId}`}><Spinner size="extra-tiny" /><div><strong>{lock.position} 占用中</strong><small>{lock.holder} · {lock.eventId}</small></div></div>
            ))}
            {state.lifeConflicts.length === 0 && <div className="empty-note"><AlertRegular /><span>暂无冲突留痕</span></div>}
            {state.lifeConflicts.slice(0, 6).map((conflict) => (
              <div className="conflict-row" key={conflict.eventId}><WarningRegular /><div><strong>{conflict.eventId} 被占用冲突</strong><small>{conflict.heldBy} 先到 · {conflict.time}</small><p>{conflict.message}</p></div></div>
            ))}
          </section>

          <section className="panel life-sign-panel">
            <div className="panel-head"><h2>依赖签字</h2><PeopleRegular /></div>
            {state.signatures.filter((item) => item.stage === '适航' || item.stage === '放行').map((item) => (
              <div className="signoff-row" key={item.stage}>
                <div><span>{item.stage}阶段</span><strong>{item.actor}</strong><small>{item.status === '已失效' ? item.invalidReason : item.time}</small></div>
                {item.status === '已签署'
                  ? <Badge appearance="tint" color="success">已签署</Badge>
                  : item.status === '已失效'
                    ? <Badge appearance="tint" color="danger">已失效</Badge>
                    : <Button size="small" appearance="primary" onClick={() => dispatch(signStage(item.stage))}>签署</Button>}
              </div>
            ))}
          </section>
        </aside>
      </div>

      <Dialog open={correctTarget !== null} onOpenChange={(_, data) => !data.open && setCorrectTarget(null)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>件履历修正（仅装机件）</DialogTitle>
            <DialogContent>
              修正 {correctTarget?.id}（{correctTarget?.name}）的件履历起始值后，仅重算该当前装机件，并使适航/放行签字失效；已拆件不可改、原值保留。
              <Field label="件本身起始已用 FC" className="dialog-field"><Input value={correctUsed} onChange={(_, data) => setCorrectUsed(data.value)} /></Field>
              <Field label="寿限 FC" className="dialog-field"><Input value={correctLimit} onChange={(_, data) => setCorrectLimit(data.value)} /></Field>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setCorrectTarget(null)}>取消</Button>
              <Button appearance="primary" onClick={() => {
                if (correctTarget) {
                  dispatch(correctLifeHistory({
                    partId: correctTarget.id,
                    startingUsed: Number.parseInt(correctUsed, 10),
                    lifeLimit: Number.parseInt(correctLimit, 10),
                    actor
                  }));
                }
                setCorrectTarget(null);
              }}>保存并重算</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}

function Release() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useDispatch();
  const [tab, setTab] = useState('open');
  const blockers = state.cards.filter((card) => card.status !== '已完成' && card.status !== '未开始');
  const allSigned = state.signatures.every((item) => item.status === '已签署');
  const installedParts = state.lifeParts.filter((part) => part.status === '装机');
  const lifeShort = installedParts.some((part) => partRemaining(part, state.airframeCycles) < LIFE_MIN_REMAINING);
  const hasDrafts = state.lifeDrafts.length > 0;
  const signedCount = state.signatures.filter((item) => item.status === '已签署').length;
  const releaseBlocked = !allSigned || blockers.some((card) => card.status === '待授权') || lifeShort || hasDrafts;
  return (
    <div className="page">
      <PageHeading eyebrow="RELEASE REVIEW / B-7891" title="放行审阅" description="核对未关闭项目、重复缺陷、关键证据、寿命账与阶段签字。" actions={<Button appearance="primary" icon={<LockClosedRegular />} disabled={releaseBlocked} onClick={() => dispatch(releasePackage())}>{state.released ? '工作包已锁定' : '锁定并放行'}</Button>} />
      {state.released && <MessageBar intent="success" className="top-message"><MessageBarBody>工作包已锁定，形成只读放行基线（R{state.baseline?.revision} @{state.baseline?.airframeCycles} FC）并纳入审计记录。</MessageBarBody></MessageBar>}
      {(lifeShort || hasDrafts) && !state.released && (
        <MessageBar intent="error" className="top-message"><MessageBarBody><strong>寿命账阻断放行：</strong>{lifeShort ? '存在装机件剩余循环低于 500 FC，必须先拆换。' : ''}{lifeShort && hasDrafts ? '；' : ''}{hasDrafts ? '存在未完成的拆换草稿，请按原事件号重试或放弃。' : ''}</MessageBarBody></MessageBar>
      )}
      <div className="release-grid">
        <section className="panel release-main">
          <TabList selectedValue={tab} onTabSelect={(_, data) => setTab(String(data.value))}><Tab value="open">未关闭项目 <Badge>{blockers.length}</Badge></Tab><Tab value="life">寿命账基线 <Badge>{installedParts.length}</Badge></Tab><Tab value="repeat">重复缺陷 <Badge>2</Badge></Tab><Tab value="evidence">关键证据 <Badge>12</Badge></Tab></TabList>
          <div className="tab-body">
            {tab === 'open' && blockers.map((card) => <div className="review-item" key={card.id}><span className={`risk-icon ${card.status === '待授权' ? 'danger' : ''}`}><AlertRegular /></span><div><strong>{card.id} · {card.title}</strong><p>{card.finding || '工卡正在执行，完成后需由放行人员复核。'}</p><small>{card.zone} · 负责人 宋杰 · 要求证据 {card.evidence}</small></div><Badge appearance="tint" color={card.status === '待授权' ? 'danger' : 'warning'}>{card.status}</Badge></div>)}
            {tab === 'life' && (
              <div className="baseline-table">
                <div className="baseline-head"><span>时寿件</span><span>状态</span><span>循环账（当前）</span><span>放行基线（锁定时）</span><span>差异</span></div>
                {state.lifeParts.map((part) => {
                  const b = state.baseline?.parts.find((item) => item.partId === part.id);
                  const curRemaining = partRemaining(part, state.airframeCycles);
                  return (
                    <div className="baseline-row" key={part.id}>
                      <span><strong>{part.id}</strong><small>{part.name} · {part.sn}</small></span>
                      <span><Badge size="small" appearance="tint" color={part.status === '装机' ? 'brand' : 'informative'}>{part.status}</Badge></span>
                      <span>{part.status === '装机' ? `已用 ${partTotalUsed(part, state.airframeCycles)} / 剩 ${curRemaining} FC` : `已拆 · 固化 ${part.frozenConsumed} FC`}</span>
                      <span>{b ? `已用 ${b.used} / 剩 ${b.remaining} FC` : '—（基线锁定后新装）'}</span>
                      <span>{b && part.status === '装机' ? <span className={curRemaining - b.remaining < 0 ? 'danger-text' : ''}>{curRemaining - b.remaining} FC</span> : '—'}</span>
                    </div>
                  );
                })}
                <small className="frozen-note">循环账与履历账继续变化不影响已锁定基线；基线之后若有拆换/循环变化，适航与放行签字失效，需重新签署后再形成新基线。</small>
              </div>
            )}
            {tab === 'repeat' && <><div className="review-item"><span className="risk-icon danger"><HistoryRegular /></span><div><strong>液压系统压力偏低 · 第 3 次记录</strong><p>2026-08-16、09-02、09-29 均在系统 A 出现压力低于目标值。</p><small>建议移交可靠性分析，并关联历史排故记录。</small></div><Badge appearance="tint" color="danger">关键</Badge></div><div className="review-item"><span className="risk-icon"><HistoryRegular /></span><div><strong>APU 启动时间延长</strong><p>最近两次航线记录均略高于机队均值。</p><small>非放行阻塞项，建议后续监控。</small></div><Badge appearance="tint" color="warning">观察</Badge></div></>}
            {tab === 'evidence' && <div className="evidence-grid">{['液压系统测试记录.pdf', '发动机孔探照片_01.jpg', 'AD 执行签署页.pdf', '时寿件履历截图.png', '超差工程指令.pdf', '见证人签字单.pdf'].map((file) => <div className="evidence-tile" key={file}><DocumentBulletListRegular /><strong>{file}</strong><span>已绑定工卡 · 已核验</span></div>)}</div>}
          </div>
        </section>
        <aside className="release-side">
          <section className="panel signoff-card"><div className="panel-head"><h2>分阶段签字</h2><span>{signedCount} / {state.signatures.length}</span></div>{state.signatures.map((item) => <div className="signoff-row" key={item.stage}><div><span>{item.stage}</span><strong>{item.actor}</strong><small>{item.status === '已失效' ? item.invalidReason : item.time}</small></div>{item.status === '已签署' ? <Badge appearance="tint" color="success">已签署</Badge> : item.status === '已失效' ? <Badge appearance="tint" color="danger">已失效·重签</Badge> : <Button size="small" appearance="primary" onClick={() => dispatch(signStage(item.stage))}>签署</Button>}</div>)}</section>
          <section className="panel release-gate-card"><LockClosedRegular /><h3>放行门禁</h3><label><Checkbox checked={!blockers.some((card) => card.status === '待授权')} readOnly /> 无待授权超差项目</label><label><Checkbox checked={state.cards.filter((card) => card.status === '已完成').length >= 6} readOnly /> 关键工卡完成率 ≥ 75%</label><label><Checkbox checked={!lifeShort} readOnly /> 装机时寿件剩余循环 ≥ {LIFE_MIN_REMAINING} FC</label><label><Checkbox checked={!hasDrafts} readOnly /> 无待重试的拆换草稿</label><label><Checkbox checked={allSigned} readOnly /> 五个阶段均完成电子签署</label><label><Checkbox checked /> 审计记录和证据附件完整</label></section>
        </aside>
      </div>
    </div>
  );
}

function Audit() {
  const state = useSelector((root: RootState) => root.maintenance);
  const [selected, setSelected] = useState('R7');
  const downloadAudit = () => {
    const csv = ['时间,操作者,动作,说明', ...state.audit.map((item) => [item.time, item.actor, item.action, item.detail].join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'B7891-48A-audit.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const diffs = useMemo(() => [
    { card: 'CARD-03', field: '容差', from: '≥ 2800 psi / 10 min', to: '≥ 2850 psi / 10 min', reason: 'AMM 临时修订 TR-114' },
    { card: 'CARD-07', field: '依赖', from: 'CARD-02', to: 'CARD-03', reason: '试车前置条件调整' },
    { card: 'CARD-08', field: '证据', from: '近 2 次记录', to: '近 3 次记录', reason: '可靠性复核要求' },
    { card: 'CARD-09', field: '寿命账', from: '人工台账核对', to: '装机冻结/拆下固化自动计寿', reason: '时寿件拆换纳入放行基线' }
  ], []);
  return (
    <div className="page">
      <PageHeading eyebrow="AUDIT / VERSION CONTROL" title="审计与版本差异" description="对比工卡版本、查看操作历史（含寿命账拆换、签字失效与冲突留痕）并导出闭环证据。" actions={<Button appearance="primary" icon={<ArrowDownloadRegular />} onClick={downloadAudit}>导出审计记录</Button>} />
      <div className="audit-grid">
        <section className="panel diff-panel"><div className="panel-head"><div><h2>工卡版本差异</h2><span>R6 → R7 · 4 处变更</span></div><select value={selected} onChange={(event) => setSelected(event.target.value)}><option>R7</option><option>R6</option><option>R5</option></select></div><div className="diff-table"><div className="diff-head"><span>工卡</span><span>字段</span><span>原值</span><span>新值 / 原因</span></div>{diffs.map((diff) => <div className="diff-row" key={`${diff.card}-${diff.field}`}><strong>{diff.card}</strong><span>{diff.field}</span><del>{diff.from}</del><div><ins>{diff.to}</ins><small>{diff.reason}</small></div></div>)}</div></section>
        <section className="panel audit-panel"><div className="panel-head"><div><h2>完整审计时间线</h2><span>{state.audit.length} 条记录</span></div><HistoryRegular /></div>{state.audit.map((item, index) => <div className="audit-row" key={`${item.time}-${index}`}><span className="timeline-dot" /><div><strong>{item.action}</strong><p>{item.detail}</p><small>{item.time} · {item.actor}</small></div></div>)}</section>
      </div>
    </div>
  );
}

function NotFound() {
  return <Navigate to="/" replace />;
}

export default function App() {
  return (
    <FluentProvider theme={webLightTheme}>
      <BrowserRouter>
        <Shell><Routes><Route path="/" element={<Overview />} /><Route path="/execution" element={<Execution />} /><Route path="/life" element={<LifeLedger />} /><Route path="/release" element={<Release />} /><Route path="/audit" element={<Audit />} /><Route path="*" element={<NotFound />} /></Routes></Shell>
      </BrowserRouter>
    </FluentProvider>
  );
}
