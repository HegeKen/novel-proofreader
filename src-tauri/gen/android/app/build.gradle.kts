import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "cn.helilab.proofreader"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "cn.helilab.proofreader"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
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
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")

// >>> dsh-signing:begin (由 pnpm run setup:signing 生成，请勿手工修改)
val dshKeystorePropertiesFile = rootProject.file("keystore.properties")
val dshKeystoreProps = mutableMapOf<String, String>()
if (dshKeystorePropertiesFile.exists()) {
    dshKeystorePropertiesFile.readLines().forEach { line ->
        val trimmed = line.trim()
        if (trimmed.isNotEmpty() && !trimmed.startsWith("#")) {
            val separator = trimmed.indexOf('=')
            if (separator > 0) {
                dshKeystoreProps[trimmed.substring(0, separator).trim()] =
                    trimmed.substring(separator + 1).trim()
            }
        }
    }
}

if (!dshKeystorePropertiesFile.exists()) {
    logger.warn("[dsh-signing] keystore.properties 不存在，release 产物不会被签名。请运行: pnpm run setup:signing")
}

android {
    signingConfigs {
        if (dshKeystorePropertiesFile.exists()) {
            create("release") {
                val dshStoreFile = dshKeystoreProps["storeFile"]
                storeFile = if (dshStoreFile != null) rootProject.file(dshStoreFile) else null
                // storeType 必须与文件真实格式一致（Android Studio 旧版产出 JKS，新版 PKCS12）
                val dshStoreType = dshKeystoreProps["storeType"]
                if (dshStoreType != null) storeType = dshStoreType
                storePassword = dshKeystoreProps["storePassword"]
                keyAlias = dshKeystoreProps["keyAlias"]
                keyPassword = dshKeystoreProps["keyPassword"]
                // 固定签名方案，保证同一 key 下签名结果稳定
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = false
            }
        }
    }
    buildTypes {
        getByName("release") {
            if (dshKeystorePropertiesFile.exists()) {
                signingConfig = signingConfigs.findByName("release")
            }
        }
    }
    // 依赖元数据块含构建期生成的哈希，是 APK/AAB 不可复现的主要来源之一
    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }
}

// 归档任务可复现：不写入构建时间戳、条目顺序稳定
tasks.withType<org.gradle.api.tasks.bundling.AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}
// <<< dsh-signing:end
