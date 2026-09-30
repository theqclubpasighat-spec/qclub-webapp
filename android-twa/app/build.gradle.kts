plugins {
    id("com.android.application")
}

android {
    namespace = "com.theqclubpasighat.qclub"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.theqclubpasighat.qclub"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.3")
}
