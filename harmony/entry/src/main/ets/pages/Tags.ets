/**
 * 标签管理（对齐安卓 TagsScreen.kt）：彩色圆 + 名称 + 新增/编辑/删除。
 */
import router from '@ohos.router';
import { TagRequest } from '../common/models';
import * as Api from '../common/api/Api';
import { ApiError } from '../common/http/Http';
import { toast, toastLong } from '../common/ui';
import { COLORS, USER_PALETTE, LAYOUT } from '../common/theme';
import { TopBar, EmptyState, LoadingBox, CategoryIcon, FloatingButton, Chip, BottomSheet, SheetHeader, AppBackground , ConfirmDialog } from '../common/components/Components';

// 调色板已收口到 theme.ts 的 USER_PALETTE（统一饱和度，详见那里的说明）
const ICONS: string[] = ['🏷️', '⭐', '🔥', '💡', '🎯', '❤️', '🌟', '⚡', '🌈', '🍀', '📌', '✅'];

interface TagItem { id: number; name: string; icon?: string; color?: string; }

@Component
export struct TagPage {
  @StorageProp('themeMode') themeMode: string = 'system';
  @State tags: TagItem[] = [];
  @State loading: boolean = true;   // 首帧即骨架屏；load() 里 finally 复位
  @State showEdit: boolean = false;
  // 待删除项：非 null 即弹确认框。删除是不可撤销操作，不能一点即删
  @State pendingDelete: TagItem | null = null;
  @State editingId: number = 0;
  @State fName: string = '';
  @State fIcon: string = '🏷️';
  @State fColor: string = USER_PALETTE[0];

  aboutToAppear(): void { this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const r = await Api.getTags();
      if (r.success) this.tags = r.data as TagItem[] || [];
    } catch (e) { console.error('Tags:', (e as ApiError).message); }
    finally { this.loading = false; }
  }

  openAdd(): void { this.editingId = 0; this.fName = ''; this.fIcon = '🏷️'; this.fColor = USER_PALETTE[0]; this.showEdit = true; }
  openEdit(t: TagItem): void { this.editingId = t.id; this.fName = t.name; this.fIcon = t.icon || '🏷️'; this.fColor = t.color || USER_PALETTE[0]; this.showEdit = true; }

  async save(): Promise<void> {
    if (!this.fName) { toast('请填写标签名称'); return; }
    const req: TagRequest = { name: this.fName, icon: this.fIcon, color: this.fColor };
    try {
      if (this.editingId) await Api.updateTag(this.editingId, req);
      else await Api.createTag(req);
      this.showEdit = false;
      this.load();
      toast('已保存');
    } catch (e) {
      toastLong('保存标签失败：' + ((e as ApiError).message || '请检查网络'));
    }
  }
  async remove(t: TagItem): Promise<void> {
    try {
      await Api.deleteTag(t.id);
      toast('已删除');
      this.load();
    } catch (e) {
      // 静默吞掉删除失败会让用户以为删成功了，刷新后条目又回来 —— 必须提示
      toastLong('删除标签失败：' + ((e as ApiError).message || '请检查网络'));
    }
  }

  @Builder EditSheet() {
    Column({ space: 12 }) {
      SheetHeader({ title: this.editingId ? '编辑标签' : '新建标签', onClose: () => { this.showEdit = false; } })
      TextInput({ placeholder: '标签名称', text: this.fName }).onChange((v: string) => this.fName = v)
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
      TopBar({ title: '标签' })
      if (this.loading) { LoadingBox() }
      else {
        Scroll() {
          Column({ space: 8 }) {
            if (this.tags.length === 0) {
              EmptyState({ text: '还没有标签，点右下角 + 新建一个' })
            } else {
              ForEach(this.tags, (t: TagItem) => {
                Row({ space: 12 }) {
                  CategoryIcon({ icon: t.icon || '🏷️', iconSize: 40 })
                  Text(t.name).fontSize(15).layoutWeight(1).fontColor(COLORS.textPrimary)
                  Row({ space: 14 }) {
                    Text('✎').fontSize(16).fontColor(COLORS.textSecondary).onClick(() => this.openEdit(t))
                    Text('🗑').fontSize(16).fontColor(COLORS.danger).onClick(() => this.pendingDelete = t)
                  }
                }.width('100%').padding({ top: 10, bottom: 10 }).backgroundColor(COLORS.cardGlass).borderRadius(12)
                .border({ width: 0.5, color: COLORS.outlineVariant })
              }, (t: TagItem) => t.id.toString())
            }
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
struct Tags {
  build() {
    Stack() {
      AppBackground()
      Column() { TagPage() }.width('100%').height('100%')
    }.width('100%').height('100%')
  }
}
