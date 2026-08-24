/**
 * 分类管理（对齐安卓 CategoryScreen.kt）：按类型分组 + 系统预设锁 + 新增/编辑。
 */
import router from '@ohos.router';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { toast, toastLong } from '../common/ui';
import { COLORS, USER_PALETTE, LAYOUT } from '../common/theme';
import { Category } from '../common/models';
import { SectionTitle, EmptyState, LoadingBox, CategoryIcon, TopBar, FloatingButton, Chip, BottomSheet, SheetHeader, AppBackground , ConfirmDialog } from '../common/components/Components';

interface Iface1 {
  key: string;
  label: string;
}

const TYPES: Iface1[] = [
  { key: 'expense', label: '支出' },
  { key: 'income', label: '收入' },
  { key: 'transfer', label: '转账' }
];
const ICONS: string[] = ['🍚', '🚗', '🛒', '🎮', '💡', '🏠', '👕', '💊', '✈️', '📱', '🎓', '🎁', '🍜', '☕', '🐱', '🏥'];
// 调色板已收口到 theme.ts 的 USER_PALETTE（统一饱和度，详见那里的说明）

@Component
export struct CategoryPage {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State cats: Category[] = [];
  @State loading: boolean = true;   // 首帧即骨架屏；load() 里 finally 复位
  @State showEdit: boolean = false;
  // 待删除项：非 null 即弹确认框。删除是不可撤销操作，不能一点即删
  @State pendingDelete: Category | null = null;
  @State editing: Category | null = null;
  @State fName: string = '';
  @State fType: string = 'expense';
  @State fIcon: string = '🍚';
  @State fColor: string = USER_PALETTE[0];

  aboutToAppear(): void { this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const r = await Api.getCategories();
      if (r.success) this.cats = r.data || [];
    } catch (e) { console.error('Category:', (e as ApiError).message); }
    finally { this.loading = false; }
  }

  grouped(key: string): Category[] {
    return this.cats.filter(c => (c.type || 'expense') === key);
  }

  openAdd(): void {
    this.editing = null;
    this.fName = ''; this.fType = 'expense'; this.fIcon = '🍚'; this.fColor = USER_PALETTE[0];
    this.showEdit = true;
  }
  openEdit(c: Category): void {
    this.editing = c;
    this.fName = c.name; this.fType = c.type; this.fIcon = c.icon || '🍚'; this.fColor = c.color || USER_PALETTE[0];
    this.showEdit = true;
  }

  async save(): Promise<void> {
    if (!this.fName) { toast('请填写分类名称'); return; }
    const req: ESObject = { name: this.fName, type: this.fType, icon: this.fIcon, color: this.fColor };
    try {
      if (this.editing) await Api.updateCategory(this.editing.id, req);
      else await Api.createCategory(req);
      this.showEdit = false;
      this.load();
      toast('已保存');
    } catch (e) {
      toastLong('保存分类失败：' + ((e as ApiError).message || '请检查网络'));
    }
  }

  async remove(c: Category): Promise<void> {
    try {
      await Api.deleteCategory(c.id);
      toast('已删除');
      this.load();
    } catch (e) {
      // 静默吞掉删除失败会让用户以为删成功了，刷新后条目又回来 —— 必须提示
      toastLong('删除分类失败：' + ((e as ApiError).message || '请检查网络'));
    }
  }

  @Builder EditSheet() {
    Column({ space: 12 }) {
      SheetHeader({ title: this.editing ? '编辑分类' : '新增分类', onClose: () => { this.showEdit = false; } })
      TextInput({ placeholder: '分类名称', text: this.fName }).onChange((v: string) => this.fName = v)
      Row({ space: 8 }) {
        Text('类型').fontSize(14).fontColor(COLORS.textSecondary)
        ForEach(TYPES, (t: ESObject) => {
          Chip({ label: t.label, active: this.fType === t.key, onTap: () => { this.fType = t.key; } })
        })
      }
      Row({ space: 6 }) {
        ForEach(ICONS, (ic: string) => {
          Chip({ label: ic, active: this.fIcon === ic, onTap: () => { this.fIcon = ic; } })
        })
      }
      Row({ space: 6 }) {
        ForEach(USER_PALETTE, (c: string) => {
          // 选中态用「外圈描边 + 内圈留白」而非内侧压边 ——
          // 内侧 2px 描边会把 28px 色块吃掉 14%，选中反而看着更小更暗
          Stack() {
            Column().width(this.fColor === c ? 20 : 28).height(this.fColor === c ? 20 : 28)
              .backgroundColor(c).borderRadius(14)
          }
          .width(30).height(30).borderRadius(15)
          .border({ width: this.fColor === c ? 2 : 0, color: COLORS.brand })
          .onClick(() => this.fColor = c)
        })
      }
      Button('保存').width('100%').onClick(() => this.save())
      Button('取消').width('100%').backgroundColor(COLORS.divider).onClick(() => this.showEdit = false)
    }
  }

  build() {
    Column() {
      TopBar({ title: '分类管理' })
      if (this.loading) { LoadingBox() }
      else {
        Scroll() {
          Column({ space: 12 }) {
            ForEach(TYPES, (t: ESObject) => {
              Column({ space: 6 }) {
                SectionTitle({ text: t.label })
                if (this.grouped(t.key).length === 0) {
                  EmptyState({ text: '暂无分类' })
                } else {
                  ForEach(this.grouped(t.key), (c: Category) => {
                    Row({ space: 12 }) {
                      CategoryIcon({ icon: c.icon || '📌', iconSize: 40 })
                      Text(c.name).fontSize(15).layoutWeight(1).fontColor(COLORS.textPrimary)
                      if (c.is_system) {
                        Text('🔒').fontSize(16)
                      } else {
                        Row({ space: 14 }) {
                          Text('✎').fontSize(16).fontColor(COLORS.textSecondary).onClick(() => this.openEdit(c))
                          Text('🗑').fontSize(16).fontColor(COLORS.danger).onClick(() => this.pendingDelete = c)
                        }
                      }
                    }.width('100%').padding({ top: 10, bottom: 10 }).backgroundColor(COLORS.cardGlass).borderRadius(12)
                    .border({ width: 0.5, color: COLORS.outlineVariant })
                  }, (c: Category) => c.id.toString())
                }
              }
            }, (t: ESObject) => t.key)
            // FAB 悬浮在 88%，最后一项需避让，否则被圆钮压住无法点击
            Blank().height(LAYOUT.fabSafe)
          }.padding(12)
        }.layoutWeight(1)
      }
      FloatingButton({ onTap: () => this.openAdd() })
      ConfirmDialog({
        show: this.pendingDelete !== null,
        title: '确认删除',
        message: '删除「' + (this.pendingDelete?.name ?? '') + '」后无法恢复',
        confirmText: '删除',
        onCancel: () => { this.pendingDelete = null; },
        onConfirm: () => {
          const target = this.pendingDelete;
          this.pendingDelete = null;
          if (target) { this.remove(target); }
        }
      })
      BottomSheet({ show: this.showEdit, maxHeight: '85%', onDismiss: () => { this.showEdit = false; } }) {
        this.EditSheet()
      }
    }.width('100%').height('100%')
  }
}

@Entry
@Component
struct CategoryEntry {
  build() {
    Stack() {
      AppBackground()
      Column() { CategoryPage() }.width('100%').height('100%')
    }.width('100%').height('100%')
  }
}
