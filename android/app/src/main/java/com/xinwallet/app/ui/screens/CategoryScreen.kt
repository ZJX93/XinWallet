package com.xinwallet.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import com.xinwallet.app.data.model.Category
import com.xinwallet.app.di.AppContainer
import com.xinwallet.app.ui.components.EmptyState
import com.xinwallet.app.ui.components.LoadingBox
import com.xinwallet.app.ui.components.TopBar
import com.xinwallet.app.ui.viewmodel.CategoryViewModel
import com.xinwallet.app.ui.viewmodel.viewModelFactory

/** 分类类型选项 */
private val CAT_TYPES = listOf("expense" to "支出", "income" to "收入", "transfer" to "转账")

@Composable
fun CategoryScreen(navController: NavHostController) {
    val vm: CategoryViewModel = viewModel(factory = viewModelFactory { CategoryViewModel(AppContainer.categoryRepository) })
    val state by vm.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(Unit) { vm.load() }
    LaunchedEffect(state.toast) { state.toast?.let { snackbar.showSnackbar(it); vm.consumeToast() } }
    LaunchedEffect(state.error) { state.error?.let { snackbar.showSnackbar(it); vm.consumeError() } }

    Scaffold(
        topBar = { TopBar("分类管理", onBack = { navController.popBackStack() }) },
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = {
            FloatingActionButton(onClick = { vm.openNew() }) { Icon(Icons.Filled.Add, "新建分类") }
        }
    ) { padding ->
        when {
            state.loading && state.categories.isEmpty() -> LoadingBox()
            state.categories.isEmpty() -> EmptyState("还没有分类，点右下角 + 新建一个")
            else -> {
                val byType = CAT_TYPES.map { (t, label) -> label to state.categories.filter { it.type == t } }
                LazyColumn(Modifier.fillMaxSize().padding(padding)) {
                    byType.forEach { (label, list) ->
                        if (list.isNotEmpty()) {
                            item { Text(label, Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            items(list) { cat ->
                                CategoryRow(
                                    cat = cat,
                                    onEdit = { vm.openEdit(cat) },
                                    onDelete = { vm.delete(cat) }
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    state.editing?.let { editing ->
        CategoryEditDialog(
            editing = editing,
            submitting = state.submitting,
            onDismiss = { vm.closeDialog() },
            onSave = { name, type, icon, color -> vm.save(name, type, icon, color) }
        )
    }
}

@Composable
private fun CategoryRow(cat: Category, onEdit: () -> Unit, onDelete: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primary, modifier = Modifier.size(36.dp)) {
            Box(contentAlignment = Alignment.Center) {
                Text(cat.icon?.ifBlank { "📌" } ?: "📌", color = Color.White, fontSize = 18.sp)
            }
        }
        Spacer(Modifier.width(12.dp))
        Text(cat.name.ifBlank { "未命名分类" }, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        if (cat.isSystem) {
            // 系统预设分类不可改不可删
            Icon(Icons.Filled.Lock, "系统预设", tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
        } else {
            IconButton(onClick = onEdit) { Icon(Icons.Filled.Edit, "编辑") }
            IconButton(onClick = onDelete) { Icon(Icons.Filled.Delete, "删除") }
        }
    }
}

@Composable
private fun CategoryEditDialog(
    editing: Category,
    submitting: Boolean,
    onDismiss: () -> Unit,
    onSave: (String, String, String, String) -> Unit
) {
    var name by remember(editing.id) { mutableStateOf(editing.name) }
    var type by remember(editing.id) { mutableStateOf(editing.type.ifBlank { "expense" }) }
    var icon by remember(editing.id) { mutableStateOf(editing.icon ?: "📌") }
    var color by remember(editing.id) { mutableStateOf(editing.color ?: "#14b8a6") }

    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = { onSave(name, type, icon, color) }, enabled = !submitting) { Text("保存") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !submitting) { Text("取消") }
        },
        title = { Text(if (editing.id == 0) "新建分类" else "编辑分类") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("名称") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Text("类型", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CAT_TYPES.forEach { (t, label) ->
                        val selected = type == t
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
                            modifier = Modifier.weight(1f).clickable { type = t }
                                .then(if (selected) Modifier else Modifier)
                        ) {
                            Text(
                                label,
                                Modifier.fillMaxWidth().padding(vertical = 10.dp),
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                                color = if (selected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                                fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal
                            )
                        }
                    }
                }
                OutlinedTextField(
                    value = icon,
                    onValueChange = { icon = it },
                    label = { Text("图标（一个 emoji）") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = color,
                    onValueChange = { color = it },
                    label = { Text("颜色（十六进制，如 #14b8a6）") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
    )
}
