plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.xinwallet.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.xinwallet.app"
        minSdk = 24
        targetSdk = 34
        // 版本号由 CI 在构建时通过 -PappVersionName / -PappVersionCode 注入，
        // 让 APK 自身携带真实版本号，供应用内「升级」功能比对；本地调试缺省为 1 / 0.1.0。
        versionCode = (project.findProperty("appVersionCode") as? String)?.toIntOrNull() ?: 1
        versionName = (project.findProperty("appVersionName") as? String) ?: "0.1.0"
        // 显式开启 multidex：方法数已超 65k，交由 AGP 标准分包，避免主 DEX 列表错乱
        // （曾出现 Application 被分到次要 DEX 导致启动即 NoClassDefFoundError）。
        multiDexEnabled = true
    }

    // 发布签名：优先读取 CI/本地注入的环境变量（KEYSTORE_PATH / KEY_ALIAS /
    // KEYSTORE_PASSWORD / KEY_PASSWORD）。未配置时回退到仓库内 debug.keystore，
    // 仅用于本地调试——切勿用这把公开密钥（密码 android）发布正式版。
    // 正式发布请改用一把私有发布密钥（见 android/generate_release_key.sh），
    // 并把其证书指纹填入 ApkVerifier.EXPECTED_CERT_SHA256，同时将此密钥移出仓库、由 CI Secrets 注入。
    signingConfigs {
        create("fixedDebug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
            storeType = "PKCS12"
        }
        create("releaseSign") {
            val ksPath = System.getenv("KEYSTORE_PATH")
            if (ksPath != null && ksPath.isNotBlank()) {
                storeFile = file(ksPath)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                    ?: error("已设置 KEYSTORE_PATH，但缺少 KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                    ?: error("已设置 KEYSTORE_PATH，但缺少 KEY_ALIAS")
                keyPassword = System.getenv("KEY_PASSWORD")
                    ?: error("已设置 KEYSTORE_PATH，但缺少 KEY_PASSWORD")
            } else {
                storeFile = file("debug.keystore")
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
                storeType = "PKCS12"
            }
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("fixedDebug")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("releaseSign")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        // AGP 8.x 默认不再生成 BuildConfig，应用内升级需要读取 BuildConfig.VERSION_NAME，必须显式开启
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    val composeBom = "androidx.compose:compose-bom:2024.10.01"
    implementation(platform(composeBom))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material") // 提供 pullRefresh / PullRefreshIndicator（下拉刷新）
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-process:2.8.4") // ProcessLifecycleOwner：整个 APP 进出后台才触发（系统选择器跳转不算后台）
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.4")
    implementation("androidx.navigation:navigation-compose:2.8.2")
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.google.code.gson:gson:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    debugImplementation("androidx.compose.ui:ui-tooling")

    // multidex 运行时支持（MultiDexApplication / MultiDex.install）
    implementation("androidx.multidex:multidex:2.0.1")
}
