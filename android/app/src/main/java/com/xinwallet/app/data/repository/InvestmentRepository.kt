package com.xinwallet.app.data.repository

import com.xinwallet.app.data.model.CreateInvestmentRequest
import com.xinwallet.app.data.model.UpdateInvestmentRequest
import com.xinwallet.app.data.remote.ApiService
import com.xinwallet.app.data.remote.safeApiCall
import com.xinwallet.app.data.remote.safeUnitCall

class InvestmentRepository(private val apiProvider: () -> ApiService) {
    suspend fun getTypes() = safeApiCall { apiProvider().getInvestmentTypes() }
    suspend fun getInvestments(includeSold: Boolean = false) = safeApiCall { apiProvider().getInvestments(includeSold) }
    suspend fun createInvestment(req: CreateInvestmentRequest) = safeApiCall { apiProvider().createInvestment(req) }
    suspend fun updateInvestment(id: Int, req: UpdateInvestmentRequest) = safeUnitCall { apiProvider().updateInvestment(id, req) }
    suspend fun deleteInvestment(id: Int) = safeUnitCall { apiProvider().deleteInvestment(id) }
    suspend fun getTransactions(id: Int) = safeApiCall { apiProvider().getInvestmentTransactions(id) }
    suspend fun deleteTransaction(investmentId: Int, txnId: Int) = safeUnitCall { apiProvider().deleteInvestmentTransaction(investmentId, txnId) }
    suspend fun editTransaction(investmentId: Int, txnId: Int, req: com.xinwallet.app.data.model.UpdateInvestmentTxnRequest) = safeUnitCall { apiProvider().updateInvestmentTransaction(investmentId, txnId, req) }
    suspend fun addTransaction(id: Int, req: com.xinwallet.app.data.model.AddInvestmentTxnRequest) = safeUnitCall { apiProvider().addInvestmentTransaction(id, req) }
    suspend fun reduce(id: Int, req: com.xinwallet.app.data.model.ReduceInvestmentRequest) = safeUnitCall { apiProvider().reduceInvestment(id, req) }
    suspend fun sell(id: Int, req: com.xinwallet.app.data.model.SellInvestmentRequest) = safeUnitCall { apiProvider().sellInvestment(id, req) }
}
