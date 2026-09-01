package com.xinwallet.app.data.repository

import com.xinwallet.app.data.model.CreateDebtRequest
import com.xinwallet.app.data.model.CreateRepaymentRequest
import com.xinwallet.app.data.model.UpdateDebtRequest
import com.xinwallet.app.data.model.UpdateRepaymentRequest
import com.xinwallet.app.data.remote.ApiService
import com.xinwallet.app.data.remote.safeApiCall
import com.xinwallet.app.data.remote.safeUnitCall

class DebtRepository(private val apiProvider: () -> ApiService) {
    suspend fun getDebts() = safeApiCall { apiProvider().getDebts() }
    suspend fun createDebt(req: CreateDebtRequest) = safeApiCall { apiProvider().createDebt(req) }
    suspend fun updateDebt(id: Int, req: UpdateDebtRequest) = safeUnitCall { apiProvider().updateDebt(id, req) }
    suspend fun deleteDebt(id: Int) = safeUnitCall { apiProvider().deleteDebt(id) }
    suspend fun getDebt(id: Int) = safeApiCall { apiProvider().getDebt(id) }
    suspend fun createRepayment(id: Int, req: CreateRepaymentRequest) = safeUnitCall { apiProvider().createRepayment(id, req) }
    suspend fun deleteRepayment(id: Int, rid: Int) = safeUnitCall { apiProvider().deleteRepayment(id, rid) }
    suspend fun updateRepayment(id: Int, rid: Int, req: UpdateRepaymentRequest) = safeUnitCall { apiProvider().updateRepayment(id, rid, req) }
}
