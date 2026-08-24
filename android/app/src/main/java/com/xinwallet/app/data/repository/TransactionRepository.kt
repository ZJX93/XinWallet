package com.xinwallet.app.data.repository

import com.xinwallet.app.data.model.CreateTransactionRequest
import com.xinwallet.app.data.model.CreateTransferRequest
import com.xinwallet.app.data.model.UpdateTransactionRequest
import com.xinwallet.app.data.remote.ApiService
import com.xinwallet.app.data.remote.safeApiCall
import com.xinwallet.app.data.remote.safeUnitCall

class TransactionRepository(private val apiProvider: () -> ApiService) {
    suspend fun getTransactions(
        month: String? = null,
        type: String? = null,
        accountId: Int? = null,
        search: String? = null,
        startDate: String? = null,
        endDate: String? = null,
        minAmount: Double? = null,
        maxAmount: Double? = null,
        types: String? = null,
        limit: Int = 50
    ) = safeApiCall {
        apiProvider().getTransactions(
            month = month,
            type = type,
            accountId = accountId,
            search = search?.takeIf { it.isNotBlank() },
            startDate = startDate,
            endDate = endDate,
            minAmount = minAmount,
            maxAmount = maxAmount,
            types = types,
            limit = limit
        )
    }

    suspend fun createTransaction(req: CreateTransactionRequest) = safeApiCall { apiProvider().createTransaction(req) }
    suspend fun updateTransaction(id: Int, req: UpdateTransactionRequest) = safeUnitCall { apiProvider().updateTransaction(id, req) }
    suspend fun deleteTransaction(id: Int) = safeUnitCall { apiProvider().deleteTransaction(id) }

    suspend fun getMonths() = safeApiCall { apiProvider().getTransactionMonths() }
    suspend fun getSummary(month: String) = safeApiCall { apiProvider().getTransactionSummary(month) }

    suspend fun getTransfers(month: String? = null) = safeApiCall { apiProvider().getTransfers(month) }
    suspend fun createTransfer(req: CreateTransferRequest) = safeApiCall { apiProvider().createTransfer(req) }
    /**
     * 修改转账。折叠转账的编辑**只能**走这里 ——
     * updateTransaction 只改单条腿，两个账户余额会对不上。详见 ApiService.updateTransfer。
     */
    suspend fun updateTransfer(id: Int, req: CreateTransferRequest) = safeUnitCall { apiProvider().updateTransfer(id, req) }
    suspend fun deleteTransfer(id: Int) = safeUnitCall { apiProvider().deleteTransfer(id) }
}
