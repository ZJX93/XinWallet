/**
 * AI 服务商编辑（新建/编辑共页，与安卓 ProviderEditScreen.kt 对齐）：
 * 路由参数 id = 0 表示新建，> 0 表示编辑现有。
 *
 * 字段：name / apiType / baseUrl / model / apiKey(编辑留空=不修改) / sortOrder / isActive
 * apiType 切换自动改默认 baseUrl + model（用户首次填表友好）。
 *
 * ArkTS 严格模式：@Builder 不接受函数参数 → 字段全部平铺到 build()。
 */
import router from '@ohos.router';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { COLORS } from '../common/theme';
import { TopBar, LoadingBox, AppBackground } from '../common/components/Components';
import { toast, toastLong } from '../common/ui';

const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_ANTHROPIC_BASE = 'https://api.anthropic.com';
const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-sonnet-latest';

@Entry
@Component
struct ProviderEdit {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State editId: number = 0;
  @State name: string = '';
  @State apiType: 'openai' | 'anthropic' = 'openai';
  @State baseUrl: string = DEFAULT_OPENAI_BASE;
  @State model: string = DEFAULT_OPENAI_MODEL;
  @State apiKey: string = '';
  @State sortOrder: number = 0;
  @State setActive: boolean = false;
  @State isExisting: boolean = false;
  @State saving: boolean = false;
  @State loading: boolean = false;
  @State apiTypeMenuOpen: boolean = false;
  @State sortOrderText: string = '0';  // TextInput 受控字符串

  aboutToAppear(): void {
    const params = router.getParams() as Record<string, Object>;
    if (params && typeof params['id'] === 'number') {
      this.editId = params['id'] as number;
    }
    if (this.editId > 0) {
      this.loadExisting(this.editId);
    }
  }

  async loadExisting(id: number): Promise<void> {
    this.loading = true;
    try {
      const r = await Api.aiProviders();
      if (r.success && r.data) {
        const list = (r.data.providers as Object as Record<string, Object>[]) || [];
        for (const p of list) {
          if ((p['id'] as number) === id) {
            this.isExisting = true;
            this.name = (p['name'] as string) || '';
            const t = (p['api_type'] as string) || 'openai';
            this.apiType = t === 'anthropic' ? 'anthropic' : 'openai';
            this.baseUrl = (p['base_url'] as string) || DEFAULT_OPENAI_BASE;
            this.model = (p['model'] as string) || DEFAULT_OPENAI_MODEL;
            this.sortOrder = typeof p['sort_order'] === 'number' ? (p['sort_order'] as number) : 0;
            this.sortOrderText = String(this.sortOrder);
            this.setActive = p['is_active'] === true;
            // 编辑模式 apiKey 永远从空开始（服务端按 trim 判定不修改）
            this.apiKey = '';
            break;
          }
        }
      }
    } catch (e) {
      toastLong('加载失败：' + (e instanceof ApiError ? e.message : '网络异常'));
    }
    this.loading = false;
  }

  /**
   * apiType 切换自动改默认 baseUrl + model（仅新建模式；编辑模式保留用户已填值）。
   */
  switchType(t: 'openai' | 'anthropic'): void {
    this.apiType = t;
    if (!this.isExisting) {
      if (t === 'anthropic') {
        this.baseUrl = DEFAULT_ANTHROPIC_BASE;
        this.model = DEFAULT_ANTHROPIC_MODEL;
      } else {
        this.baseUrl = DEFAULT_OPENAI_BASE;
        this.model = DEFAULT_OPENAI_MODEL;
      }
    }
    this.apiTypeMenuOpen = false;
  }

  validate(): string | null {
    if (!this.name.trim()) return '请填写服务商名称';
    if (!this.baseUrl.trim()) return '请填写 Base URL';
    if (!this.model.trim()) return '请填写 Model';
    if (!this.isExisting && !this.apiKey.trim()) return '请填写 API Key';
    return null;
  }

  async save(): Promise<void> {
    const err = this.validate();
    if (err) { toast(err); return; }

    this.saving = true;
    try {
      const payload: Api.AiProviderPayload = {
        name: this.name.trim(),
        api_type: this.apiType,
        base_url: this.baseUrl.trim(),
        model: this.model.trim(),
        api_key: this.apiKey.trim(),
        sort_order: this.sortOrder,
        is_active: this.setActive
      };
      if (this.isExisting) {
        const r = await Api.aiProviderUpdate(this.editId, payload);
        if (r.success) {
          toast('已保存');
          router.back();
        } else {
          toastLong('保存失败：' + ((r.message as string) || ''));
        }
      } else {
        const r = await Api.aiProviderCreate(payload);
        if (r.success) {
          toast('已创建');
          router.back();
        } else {
          toastLong('创建失败：' + ((r.message as string) || ''));
        }
      }
    } catch (e) {
      toastLong('出错：' + (e instanceof ApiError ? e.message : '网络异常'));
    } finally {
      this.saving = false;
    }
  }

  build() {
    Stack() {
      AppBackground()
      Column() {
        TopBar({
          title: this.isExisting ? '编辑服务商' : '新增服务商',
          onBack: () => router.back()
        })

        if (this.loading) {
          LoadingBox()
        } else {
          Scroll() {
            Column() {
              // ---- 1. 名称 ----
              Column() {
                Text('名称').fontSize(13).fontColor(COLORS.textSecondary).margin({ bottom: 6 })
                TextInput({ placeholder: '如 OpenAI 主号', text: this.name })
                  .height(44)
                  .width('100%')
                  .backgroundColor(COLORS.surface)
                  .borderRadius(8)
                  .padding({ left: 12, right: 12 })
                  .onChange((v: string) => { this.name = v })
              }
              .alignItems(HorizontalAlign.Start).margin({ top: 16 }).width('100%')

              // ---- 2. 类型（Dropdown） ----
              Column() {
                Text('类型').fontSize(13).fontColor(COLORS.textSecondary).margin({ bottom: 6 })
                Row() {
                  Text(this.apiType === 'openai' ? 'OpenAI 兼容' : 'Anthropic')
                    .height(44).layoutWeight(1)
                    .padding({ left: 12 })
                    .backgroundColor(Color.Transparent)
                    .fontColor(COLORS.textPrimary)
                  Text(this.apiTypeMenuOpen ? '▲' : '▼').fontSize(12).fontColor(COLORS.textSecondary)
                    .padding({ right: 12 })
                }
                .alignItems(VerticalAlign.Center)
                .width('100%')
                .backgroundColor(COLORS.surface)
                .borderRadius(8)
                .onClick(() => { this.apiTypeMenuOpen = !this.apiTypeMenuOpen })

                if (this.apiTypeMenuOpen) {
                  Column() {
                    Row() {
                      Text('OpenAI 兼容').fontSize(14).fontColor(COLORS.textPrimary).layoutWeight(1)
                    }
                    .padding({ left: 12, right: 12, top: 14, bottom: 14 })
                    .onClick(() => this.switchType('openai'))

                    Row() {
                      Text('Anthropic').fontSize(14).fontColor(COLORS.textPrimary).layoutWeight(1)
                    }
                    .padding({ left: 12, right: 12, top: 14, bottom: 14 })
                    .onClick(() => this.switchType('anthropic'))
                  }
                  .width('100%')
                  .backgroundColor(COLORS.surface)
                  .borderRadius(8)
                  .margin({ top: 4 })
                }
              }
              .alignItems(HorizontalAlign.Start).margin({ top: 16 }).width('100%')

              // ---- 3. Base URL ----
              Column() {
                Text('Base URL').fontSize(13).fontColor(COLORS.textSecondary).margin({ bottom: 6 })
                Row() {
                  TextInput({ placeholder: 'https://...', text: this.baseUrl })
                    .height(44).layoutWeight(1)
                    .backgroundColor(Color.Transparent)
                    .padding({ left: 0, right: 0 })
                    .onChange((v: string) => { this.baseUrl = v })
                }
                .padding({ left: 12, right: 12 })
                .backgroundColor(COLORS.surface)
                .borderRadius(8).height(44)
              }
              .alignItems(HorizontalAlign.Start).margin({ top: 16 }).width('100%')

              // ---- 4. Model ----
              Column() {
                Text('Model').fontSize(13).fontColor(COLORS.textSecondary).margin({ bottom: 6 })
                Row() {
                  TextInput({ placeholder: '如 gpt-4o', text: this.model })
                    .height(44).layoutWeight(1)
                    .backgroundColor(Color.Transparent)
                    .padding({ left: 0, right: 0 })
                    .onChange((v: string) => { this.model = v })
                }
                .padding({ left: 12, right: 12 })
                .backgroundColor(COLORS.surface)
                .borderRadius(8).height(44)
              }
              .alignItems(HorizontalAlign.Start).margin({ top: 16 }).width('100%')

              // ---- 5. API Key ----
              Column() {
                Text(this.isExisting ? 'API Key（留空不修改）' : 'API Key')
                  .fontSize(13).fontColor(COLORS.textSecondary).margin({ bottom: 6 })
                TextInput({
                  placeholder: this.isExisting ? '当前 key 已掩码保存' : 'sk-...',
                  text: this.apiKey
                })
                  .height(44).width('100%')
                  .type(InputType.Password)
                  .backgroundColor(COLORS.surface)
                  .borderRadius(8)
                  .padding({ left: 12, right: 12 })
                  .onChange((v: string) => { this.apiKey = v })
                if (this.isExisting) {
                  Text('留空不会覆盖现有 Key').fontSize(11).fontColor(COLORS.placeholder).margin({ top: 4 })
                }
              }
              .alignItems(HorizontalAlign.Start).margin({ top: 16 }).width('100%')

              // ---- 6. 排序权重 ----
              Column() {
                Text('排序权重（数字越小越靠前）').fontSize(13).fontColor(COLORS.textSecondary).margin({ bottom: 6 })
                TextInput({ placeholder: '0', text: this.sortOrderText })
                  .height(44).width('100%')
                  .type(InputType.Number)
                  .backgroundColor(COLORS.surface)
                  .borderRadius(8)
                  .padding({ left: 12, right: 12 })
                  .onChange((v: string) => {
                    this.sortOrderText = v
                    const n = parseInt(v || '0', 10)
                    if (!isNaN(n)) this.sortOrder = n
                  })
              }
              .alignItems(HorizontalAlign.Start).margin({ top: 16 }).width('100%')

              // ---- 7. 设为默认 ----
              Row() {
                Toggle({ type: ToggleType.Switch, isOn: this.setActive })
                  .selectedColor(COLORS.brand)
                  .onChange((on: boolean) => { this.setActive = on })
                Text(this.isExisting ? '设为默认（激活）' : '保存后激活为默认')
                  .fontSize(14).fontColor(COLORS.textPrimary)
                  .margin({ left: 12 })
              }
              .margin({ top: 20 })
              .alignItems(VerticalAlign.Center)

              // ---- 8. 保存按钮 ----
              Button(this.saving ? '保存中...' : '保存')
                .width('100%').height(48)
                .backgroundColor(COLORS.brand)
                .fontColor(Color.White).fontSize(16)
                .borderRadius(24)
                .margin({ top: 32 })
                .onClick(() => this.save())
                .enabled(!this.saving)
            }
            .padding({ left: 16, right: 16, top: 12, bottom: 32 })
          }
          .layoutWeight(1)
          .edgeEffect(EdgeEffect.Spring)
        }
      }.width('100%').height('100%')
    }
  }
}
