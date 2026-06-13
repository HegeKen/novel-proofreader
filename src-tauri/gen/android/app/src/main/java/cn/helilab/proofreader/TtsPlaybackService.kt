package cn.helilab.proofreader

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

class TtsPlaybackService : Service() {

    private var wakeLock: PowerManager.WakeLock? = null
    private var isPlaying = true
    private var currentTitle = "TTS 朗读中..."

    companion object {
        const val CHANNEL_ID = "tts_playback"
        const val NOTIFICATION_ID = 1
        const val ACTION_PREV = "cn.helilab.proofreader.TTS_PREV"
        const val ACTION_TOGGLE = "cn.helilab.proofreader.TTS_TOGGLE"
        const val ACTION_NEXT = "cn.helilab.proofreader.TTS_NEXT"
        const val ACTION_STOP = "cn.helilab.proofreader.TTS_STOP"
        const val ACTION_UPDATE = "cn.helilab.proofreader.TTS_UPDATE"

        fun start(context: Context) {
            val intent = Intent(context, TtsPlaybackService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, TtsPlaybackService::class.java))
        }

        fun updateTitle(context: Context, title: String) {
            val intent = Intent(context, TtsPlaybackService::class.java).apply {
                action = ACTION_UPDATE
                putExtra("title", title)
            }
            context.startService(intent)
        }

        fun updatePlayingState(context: Context, playing: Boolean) {
            val intent = Intent(context, TtsPlaybackService::class.java).apply {
                action = ACTION_UPDATE
                putExtra("isPlaying", playing)
            }
            context.startService(intent)
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        acquireWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PREV -> sendBroadcastToWeb("tts-prev")
            ACTION_TOGGLE -> {
                isPlaying = !isPlaying
                sendBroadcastToWeb("tts-toggle")
            }
            ACTION_NEXT -> sendBroadcastToWeb("tts-next")
            ACTION_STOP -> {
                sendBroadcastToWeb("tts-stop")
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_UPDATE -> {
                intent.getStringExtra("title")?.let { currentTitle = it }
                if (intent.hasExtra("isPlaying")) {
                    isPlaying = intent.getBooleanExtra("isPlaying", isPlaying)
                }
            }
        }

        val notification = buildNotification(currentTitle)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        releaseWakeLock()
        super.onDestroy()
    }

    private fun sendBroadcastToWeb(action: String) {
        val broadcastIntent = Intent("cn.helilab.proofreader.TTS_ACTION").apply {
            putExtra("action", action)
            setPackage(packageName)
        }
        sendBroadcast(broadcastIntent)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "TTS 朗读",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "TTS 朗读播放状态"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(content: String): Notification {
        val openAppIntent = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(
                this, 0, it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        val prevIntent = PendingIntent.getService(
            this, 1,
            Intent(this, TtsPlaybackService::class.java).apply { action = ACTION_PREV },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val toggleIntent = PendingIntent.getService(
            this, 2,
            Intent(this, TtsPlaybackService::class.java).apply { action = ACTION_TOGGLE },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val nextIntent = PendingIntent.getService(
            this, 3,
            Intent(this, TtsPlaybackService::class.java).apply { action = ACTION_NEXT },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val stopIntent = PendingIntent.getService(
            this, 4,
            Intent(this, TtsPlaybackService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            Notification.Builder(this)
        }

        val playPauseIcon = if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play

        return builder
            .setContentTitle("AI 排版校对助手")
            .setContentText(content)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(openAppIntent)
            .addAction(Notification.Action.Builder(
                null, "上一段", prevIntent
            ).build())
            .addAction(Notification.Action.Builder(
                null, if (isPlaying) "暂停" else "播放", toggleIntent
            ).build())
            .addAction(Notification.Action.Builder(
                null, "下一段", nextIntent
            ).build())
            .addAction(Notification.Action.Builder(
                null, "停止", stopIntent
            ).build())
            .setStyle(Notification.MediaStyle()
                .setShowActionsInCompactView(0, 1, 2))
            .setOngoing(isPlaying)
            .build()
    }

    private fun acquireWakeLock() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "proofreader:tts").apply {
            acquire(60 * 60 * 1000L)
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
        wakeLock = null
    }
}
