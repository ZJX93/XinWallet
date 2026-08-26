/**
 * AI 服务商配置（对齐安卓 ProviderListScreen.kt）：
 * 列表展示用户配置的所有对话服务商（openai / anthropic）。
 *
 * 每行支持 激活切换 / 测试连接 / 删除 / 点击进入编辑。
 * 单选激活：点「设为默认」会触发服务端单选语义（旧激活条目自动 inactive）。
 * 测试连接中用 testingId 标记，不阻塞其他行 UI（与安卓一致）。
 */
import router from '@ohos.router';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { COLORS, fmtMoney } from '../common/theme';
import { TopBar, LoadingBox, EmptyState, AppBackground } from '../common/components/Components';
import { toast, toastLong } from '../common/ui';

interface ProviderRow {
  id: number;
  name: string;
  apiType: string;
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
  isActive: boolean;
  sortOrder: number;
  hasError?: boolean;
}

@Entry
@Component
struct ProviderList {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State loading: boolean = false;
  @State providers: ProviderRow[] = [];
  @State errorMsg: string = '';
  @State testingId: number = -1;       // -1 = 无行测试中
  @State pendingDeleteId: number = -1; // 二次确认展开的行
  @State updatingId: number = -1;      // 切换激活中的行
  @State refreshToken: number = 0;     // 用于下拉刷新强制重渲染

  aboutToAppear(): void { this.load(); }

  async load(): Promise<void> {
    this.loading = this.providers.length === 0;
    this.errorMsg = '';
    try {
      const r = await Api.aiProviders();
      if (r.success && r.data) {
        const list = (r.data.providers as Object as ProviderRow[]) || [];
        this.providers = list
          .sort((a, b) => (a.sortOrder - b.sortOrder))
          .map((p) => {
            const row: ProviderRow = {
              id: p.id, name: p.name || '', apiType: p.apiType || 'openai',
              baseUrl: p.baseUrl || '', model: p.model || '', apiKeyMasked: p.apiKeyMasked || '',
              isActive: p.isActive === true, sortOrder: p.sortOrder || 0
            };
            return row;
          });
        if (this.providers.length === 0) {
          this.errorMsg = '还没有配置服务商，点右下角 + 新增';
        }
      } else {
        this.errorMsg = (r.message as string) || '加载服务商失败';
      }
    } catch (e) {
      this.errorMsg = e instanceof ApiError ? e.message : '网络异常';
    }
    this.loading = false;
  }

  /**
   * 测试连接：调用 /ai/providers/:id/test，服务端实际发一次"回复 OK"调用。
   * 结果用 AlertDialog 反馈，测试期间 testingId = id。
   */
  async testConnection(id: number): Promise<void> {
    this.testingId = id;
    try {
      const r = await Api.aiProviderTest(id);
      if (r.success && r.data && r.data.ok === true) {
        toastLong('连接成功：' + ((r.data.reply as string) || 'OK'));
      } else {
        const msg = (r.data && (r.data.error as string)) || (r.message as string) || '连接失败';
        toastLong('测试失败：' + msg);
      }
    } catch (e) {
      toastLong('测试出错：' + (e instanceof ApiError ? e.message : '网络异常'));
    } finally {
      this.testingId = -1;
    }
  }

  /**
   * 设为默认（激活）：服务端单选语义，会自动 deactivate 其他。
   */
  async activate(id: number): Promise<void> {
    this.updatingId = id;
    try {
      const r = await Api.aiProviderActivate(id);
      if (r.success) {
        // 乐观更新：本地标记
        const updated: ProviderRow[] = [];
        for (const p of this.providers) {
          const next: ProviderRow = {
            id: p.id, name: p.name, apiType: p.apiType, baseUrl: p.baseUrl,
            model: p.model, apiKeyMasked: p.apiKeyMasked, sortOrder: p.sortOrder,
            isActive: p.id === id
          };
          updated.push(next);
        }
        this.providers = updated;
        toast('已设为默认服务商');
      } else {
        toastLong('激活失败：' + ((r.message as string) || ''));
      }
    } catch (e) {
      toastLong('激活出错：' + (e instanceof ApiError ? e.message : '网络异常'));
    } finally {
      this.updatingId = -1;
    }
  }

  /**
   * 删除：二次确认展开后用户点"确认删除"才真正调用。
   */
  async doDelete(id: number): Promise<void> {
    try {
      const r = await Api.aiProviderDelete(id);
      if (r.success) {
        this.providers = this.providers.filter((p) => p.id !== id);
        this.pendingDeleteId = -1;
        toast('已删除');
      } else {
        toastLong('删除失败：' + ((r.message as string) || ''));
      }
    } catch (e) {
      toastLong('删除出错：' + (e instanceof ApiError ? e.message : '网络异常'));
    }
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      AppBackground()
      Column() {
        TopBar({ title: 'AI 服务商', onBack: () => router.back() })

        if (this.loading) {
          LoadingBox()
        } else if (this.providers.length === 0) {
          EmptyState({ icon: '🤖', text: this.errorMsg || '还没有服务商，点右下角 + 新增' })
        } else {
          List({ space: 12 }) {
            ForEach(this.providers, (p: ProviderRow) => {
              ListItem() { this.ProviderCard(p) }
            }, (p: ProviderRow) => 'provider_' + p.id + '_' + this.refreshToken)
          }
          .layoutWeight(1)
          .padding({ left: 16, right: 16, top: 12, bottom: 96 })
          .onClick(() => { this.pendingDeleteId = -1 }) // 点空白处收起确认行
        }
      }.width('100%').height('100%')

      // FAB：右下角 + 新增
      Button('+')
        .width(56).height(56)
        .fontSize(28)
        .fontColor(Color.White)
        .backgroundColor(COLORS.brand)
        .borderRadius(28)
        .position({ x: '100%', y: '100%' })
        .markAnchor({ x: -72, y: -96 })
        .onClick(() => router.pushUrl({ url: 'pages/ProviderEdit', params: { id: 0 } }))
    }
    .height('100%')
    .width('100%')
  }

  @Builder ProviderCard(p: ProviderRow) {
    Column() {
      Row() {
        // 类型徽标
        Text(p.apiType === 'anthropic' ? '🧠' : '⚡')
          .fontSize(20).fontColor(COLORS.brand)
          .width(36).height(36)
          .textAlign(TextAlign.Center)
          .borderRadius(18)
          .backgroundColor(p.apiType === 'anthropic' ? '#FFD8B5' : '#D6E8FF')

        Column() {
          Row() {
            Text(p.name).fontSize(16).fontWeight(FontWeight.Bold).fontColor(COLORS.textPrimary)
            if (p.isActive) {
              Text('默认').fontSize(10).fontColor(Color.White)
                .backgroundColor(COLORS.brand)
                .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                .borderRadius(8)
                .margin({ left: 8 })
            }
          }
          .alignItems(VerticalAlign.Center)

          Text('Model: ' + p.model)
            .fontSize(12).fontColor(COLORS.textSecondary)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })

          Text('Key: ' + (p.apiKeyMasked || '未设置'))
            .fontSize(11).fontColor(COLORS.placeholder)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        .margin({ left: 12 })
      }
      .alignItems(VerticalAlign.Center)

      Row() {
        // 设为默认按钮：未激活时才显示
        if (!p.isActive) {
          Button('设为默认')
            .fontSize(12).fontColor(COLORS.brand)
            .backgroundColor(COLORS.brandBg)
            .height(28).padding({ left: 12, right: 12 })
            .borderRadius(14)
            .onClick(() => this.activate(p.id))
            .enabled(this.updatingId !== p.id)
        }

        // 测试连接按钮 + spinner
        if (this.testingId === p.id) {
          LoadingProgress().width(20).height(20).color(COLORS.brand)
            .margin({ left: 8 })
        } else {
          Button('测试')
            .fontSize(12).fontColor(COLORS.textPrimary)
            .backgroundColor(COLORS.surface)
            .height(28).padding({ left: 12, right: 12 })
            .borderRadius(14)
            .margin({ left: 8 })
            .onClick(() => this.testConnection(p.id))
        }

        Blank()

        // 删除按钮（点击展开二次确认）
        if (this.pendingDeleteId !== p.id) {
          Button('删除')
            .fontSize(12).fontColor(COLORS.danger)
            .backgroundColor(Color.Transparent)
            .height(28).padding({ left: 12, right: 12 })
            .borderRadius(14)
            .border({ width: 1, color: COLORS.danger, style: BorderStyle.Solid })
            .onClick(() => { this.pendingDeleteId = p.id })
        } else {
          // 展开的二次确认
          Row() {
            Text('确认删除？').fontSize(12).fontColor(COLORS.danger)
            Button('取消')
              .fontSize(11).fontColor(COLORS.textSecondary)
              .backgroundColor(Color.Transparent)
              .height(24).padding({ left: 8, right: 8 })
              .onClick(() => { this.pendingDeleteId = -1 })
            Button('确认')
              .fontSize(11).fontColor(Color.White)
              .backgroundColor(COLORS.danger)
              .height(24).padding({ left: 8, right: 8 })
              .onClick(() => this.doDelete(p.id))
          }
          .alignItems(VerticalAlign.Center)
        }
      }
      .margin({ top: 12 })
      .width('100%')
    }
    .padding(16)
    .backgroundColor(COLORS.surface)
    .borderRadius(12)
    .onClick(() => router.pushUrl({ url: 'pages/ProviderEdit', params: { id: p.id } }))
  }
}
