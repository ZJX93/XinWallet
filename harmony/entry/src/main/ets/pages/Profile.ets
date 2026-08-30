/**
 * 我的（对齐安卓 ProfileScreen.kt）：头像 + 昵称 + 已记账天数 + 编辑资料 + 宫格 + 退出登录。
 */
import router from '@ohos.router';
import * as Api from '../common/api/Api';
import { Session } from '../common/store/Session';
import { COLORS, LAYOUT } from '../common/theme';
import { User } from '../common/models';
import { IconCircle, Card } from '../common/components/Components';
import { toast, toastLong } from '../common/ui';
import { ApiError } from '../common/http/Http';

interface Iface1 {
  iconRes: string;  // app.media.xxx SVG 资源名
  label: string;
  url: string;
}

/**
 * 宫格项 —— 必须与安卓 ProfileScreen.kt 的 row1/row2/row3 逐项一致（项目、顺序、文案）。
 * 图标语义对照（安卓用 Material Icons，鸿蒙用同名 SVG 资源，图形须表达同一含义）：
 * 「实验室」已移除：AI 工具聚合仅在 Web 端提供，移动端不再入口（v0.2.x）。
 *   分类管理 Category=分类宫格（ic_tag：2x2 圆角网格）/ 标签管理 LocalOffer=标签（ic_tags）
 *   资产账户 Wallet=钱包 / 理财管理 ShowChart=走势折线 / 储蓄目标 Savings=存钱罐
 *   预算管理 Receipt=票据 / 债务管理 SwapHoriz=双向箭头 / 数据管理 Storage=存储层
 *   应用锁 Lock=挂锁 / 设置 Settings=齿轮
 * 「记一笔」不放宫格：底栏中间已有记账浮钮（Main.ets），重复入口是冗余。
 * 「截图记账」已删（与 AI 对话记账发图路径重复）：用户改走 Chat 页发图。
 */
const GRID: Iface1[] = [
  { iconRes: 'ic_tag', label: '分类管理', url: 'pages/Category' },
  { iconRes: 'ic_tags', label: '标签管理', url: 'pages/Tags' },
  { iconRes: 'ic_wallet', label: '资产账户', url: 'pages/Accounts' },
  { iconRes: 'ic_trending', label: '理财管理', url: 'pages/Investments' },
  { iconRes: 'ic_target', label: '储蓄目标', url: 'pages/SavingsGoals' },
  { iconRes: 'ic_budget', label: '预算管理', url: 'pages/Budgets' },
  { iconRes: 'ic_handshake', label: '债务管理', url: 'pages/Debts' },
  { iconRes: 'ic_save', label: '数据管理', url: 'pages/DataManagement' },
  { iconRes: 'ic_lock', label: '应用锁', url: 'pages/AppLock' },
  { iconRes: 'ic_settings', label: '设置', url: 'pages/Settings' }
];
const AVATARS: string[] = ['🦊', '🐱', '🐶', '🐼', '🦁', '🐯', '🐸', '🐵', '🐧', '🦉', '🐢', '🐙'];

@Component
export struct ProfilePage {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State nickname: string = '我';
  @State avatar: string = '🦊';
  @State days: number = 0;
  @State newName: string = '';
  @State newAvatar: string = '🦊';

  aboutToAppear(): void { this.load(); }

  async load(): Promise<void> {
    try {
      const r = await Api.profile();
      if (r.success && r.data?.user) {
        const u: User = r.data.user;
        this.nickname = u.nickname || u.username || '我';
        this.avatar = u.avatar || '🦊';
      }
    } catch (e) { /* 读失败静默降级：该区块不显示即可，不打扰用户 */ }
  }

  async saveProfile(): Promise<void> {
    try {
      await Api.updateProfile({ nickname: this.newName, avatar: this.newAvatar });
      this.nickname = this.newName;
      this.avatar = this.newAvatar;
      toast('已保存');
    } catch (e) {
      // 写操作失败必须提示：静默吞掉的话，本地 state 没更新、用户以为是界面卡了
      toastLong('保存资料失败：' + ((e as ApiError).message || '请检查网络'));
    }
  }

  openEdit(): void {
    this.newName = this.nickname;
    this.newAvatar = this.avatar;
    AlertDialog.show({
      title: '编辑资料',
      message: '',
      primaryButton: { value: '保存', action: () => { this.saveProfile(); } },
      secondaryButton: { value: '取消', action: () => {} }
    });
  }

  build() {
    Column() {
      // 头部
      Row({ space: 14 }) {
        Text(this.avatar).fontSize(40)
          .width(64).height(64).textAlign(TextAlign.Center)
          .backgroundColor(COLORS.brandBgLight).borderRadius(32)
        Column({ space: 4 }) {
          Row({ space: 6 }) {
            Text(this.nickname).fontSize(20).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
            Text('✎').fontSize(14).fontColor(COLORS.textSecondary)
              .onClick(() => this.openEdit())
          }
          Text(`已经记账 ${this.days} 天`).fontSize(13).fontColor(COLORS.textSecondary)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      }.width('100%').padding(16)

      // 12 宫格（矢量图标，fillColor 着色）—— 改用 IconCircle 复用图标盒子风格，卡片化背景
      Grid() {
        ForEach(GRID, (g: Iface1) => {
          GridItem() {
            Column({ space: 8 }) {
              // SVG 资源图标直接用 IconCircle（boxSize 52 / iconSize 26，bg 暖棕浅底）
              Stack() {
                Image($r(`app.media.${g.iconRes}`)).width(26).height(26).fillColor(COLORS.brand)
              }.width(52).height(52)
              Text(g.label).fontSize(12).fontColor(COLORS.textPrimary)
            }.width('100%').padding({ top: 16, bottom: 16 })
              .backgroundColor(COLORS.surface).borderRadius(16)
              .shadow({ radius: 1, color: '#0A000000', offsetY: 1 })
              .onClick(() => router.pushDestination({ url: g.url }))
          }
        }, (g: Iface1) => g.label)
      }.columnsTemplate('1fr 1fr 1fr 1fr').rowsGap(10).columnsGap(10)
        .padding(12).layoutWeight(1)

      // 退出登录按钮：品牌色 outline 风格（去粗实心红），更克制
      Text('退出登录').fontSize(15).fontWeight(FontWeight.Medium).fontColor(COLORS.error)
        .width('80%').textAlign(TextAlign.Center)
        .padding({ top: 12, bottom: 12 })
        .borderRadius(999)
        .border({ width: 1, color: COLORS.errorContainer })
        .backgroundColor(COLORS.errorContainer)
        .alignSelf(ItemAlign.Center)
        .onClick(async () => {
          await Session.clear();
          router.replacePath({ url: 'pages/Login' });
        })
      Blank().height(LAYOUT.bottomNavSafe)
    }.width('100%').height('100%')
  }
}

// 注：原 @Entry struct Profile 包装已删除（对应 main_pages.json 的死路由）。
// ProfilePage 是 Main 的 tab 内容，pushUrl 过去会丢底部导航栏。
// 详见 docs/harmony-style-guide.md 第 11 节。
