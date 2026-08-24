package com.xinwallet.app

import androidx.multidex.MultiDexApplication
import com.xinwallet.app.data.local.SessionManager
import com.xinwallet.app.di.AppContainer

class XWalletApplication : MultiDexApplication() {
    override fun onCreate() {
        super.onCreate()
        AppContainer.init(this, SessionManager(this))
    }
}
