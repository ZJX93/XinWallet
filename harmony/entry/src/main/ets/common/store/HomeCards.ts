/**
 * 首页功能卡片注册表。
 *
 * 首页「按需显示卡片」的单一数据源：新增一张卡片只需在 CARD_REGISTRY 追加一条，
 * 编辑弹层会自动出现对应开关，无需改动弹层代码。
 * 开关值与排列顺序都落在 preferences（见 Session.getCardVisible / getCardOrder）。
 */
import { Session } from './Session';

/** 单张首页卡片的元数据 */
export interface HomeCardMeta {
  /** 持久化 key（前缀 card_，落库为 home_card_xxx） */
  key: string;
  /** 卡片名，展示在编辑弹层 */
  title: string;
  /** 一句话说明这张卡看什么 */
  subtitle: string;
  /** 编辑弹层左侧图标 */
  icon: string;
  /** 首次安装时是否默认显示 */
  defaultOn: boolean;
}

/**
 * 卡片注册表（数组顺序即默认排列顺序）。
 * 默认只开「今日流水 + 账单日历」，其余让用户按需打开，避免首页一上来就堆满。
 */
export const CARD_REGISTRY: HomeCardMeta[] = [
  {
    key: 'card_today',
    title: '今日流水',
    subtitle: '当天记账明细，汇总在一张卡片内',
    icon: '🧾',
    defaultOn: true
  },
  {
    key: 'card_calendar',
    title: '账单日历',
    subtitle: '按月查看每日收支与记账情况',
    icon: '📅',
    defaultOn: true
  },
  {
    key: 'card_budget',
    title: '预算进度',
    subtitle: '本期预算用了多少，超支立刻变红',
    icon: '🎯',
    defaultOn: false
  },
  {
    key: 'card_category',
    title: '分类支出榜',
    subtitle: '本月钱花在哪，前五名一目了然',
    icon: '📊',
    defaultOn: false
  },
  {
    key: 'card_assets',
    title: '账户资产',
    subtitle: '各账户余额与净资产合计',
    icon: '💳',
    defaultOn: false
  },
  {
    key: 'card_goals',
    title: '储蓄目标',
    subtitle: '攒钱进度，离目标还差多少',
    icon: '🏆',
    defaultOn: false
  }
];

/** 卡片可见性映射（key -> 是否显示） */
export interface CardVisibleMap {
  [key: string]: boolean;
}

/** 按注册表默认序返回 key 列表 */
export function defaultOrder(): string[] {
  return CARD_REGISTRY.map((c: HomeCardMeta) => c.key);
}

/** 取某张卡片的元数据（未注册返回 null） */
export function metaOf(key: string): HomeCardMeta | null {
  const m = CARD_REGISTRY.find((c: HomeCardMeta) => c.key === key);
  return m ? m : null;
}

/**
 * 从持久化读取顺序，并与注册表做双向对齐：
 * - 剔除已下线的卡片 key（老版本存过、新版本删了的）
 * - 补上新增的卡片 key（新版本加的，追加到末尾）
 * 这样版本升级后用户的自定义顺序不会失效，新卡片也不会消失。
 */
export async function loadOrder(): Promise<string[]> {
  const saved = await Session.getCardOrder();
  const all = defaultOrder();
  if (!saved) {
    return all;
  }
  const parts: string[] = saved.split(',').filter((k: string) => k.length > 0);
  const valid: string[] = parts.filter((k: string) => all.indexOf(k) >= 0);
  const missing: string[] = all.filter((k: string) => valid.indexOf(k) < 0);
  return valid.concat(missing);
}

/** 持久化顺序 */
export async function saveOrder(order: string[]): Promise<void> {
  await Session.setCardOrder(order.join(','));
}

/** 批量读取所有卡片的可见性（缺省取注册表 defaultOn） */
export async function loadVisibility(): Promise<CardVisibleMap> {
  const map: CardVisibleMap = {};
  for (let i = 0; i < CARD_REGISTRY.length; i++) {
    const c = CARD_REGISTRY[i];
    map[c.key] = await Session.getCardVisible(c.key, c.defaultOn);
  }
  return map;
}

/**
 * 把某张卡片在顺序里挪一格。
 * delta 为 -1 上移、+1 下移；越界时原样返回（调用方无需判边界）。
 */
export function moveCard(order: string[], key: string, delta: number): string[] {
  const i = order.indexOf(key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) {
    return order;
  }
  const next: string[] = order.slice();
  const tmp = next[i];
  next[i] = next[j];
  next[j] = tmp;
  return next;
}
