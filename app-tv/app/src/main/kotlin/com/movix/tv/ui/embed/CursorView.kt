package com.movix.tv.ui.embed

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.view.View

/**
 * Flèche de la souris virtuelle. Dessinée une fois dans une couche matérielle,
 * puis seulement déplacée par `translationX/Y` : aucun redessin, ni d'elle ni
 * de la page en dessous.
 */
class CursorView(context: Context) : View(context) {
    private val density = resources.displayMetrics.density
    private val path = Path().apply {
        // Pointe en (0,0), comme une flèche de bureau.
        moveTo(0f, 0f)
        lineTo(0f, 19f)
        lineTo(4.6f, 14.8f)
        lineTo(7.8f, 21.8f)
        lineTo(10.6f, 20.6f)
        lineTo(7.4f, 13.7f)
        lineTo(13.6f, 13.7f)
        close()
    }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; style = Paint.Style.FILL }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.BLACK; style = Paint.Style.STROKE; strokeWidth = 1.4f; strokeJoin = Paint.Join.ROUND
    }

    init {
        setLayerType(LAYER_TYPE_HARDWARE, null)
        // Le curseur ne reçoit jamais les touches ni les clics.
        isClickable = false
        isFocusable = false
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension((SIZE_DP * density).toInt(), (SIZE_DP * density).toInt())
    }

    override fun onDraw(canvas: Canvas) {
        val scale = density * 1.25f
        canvas.save()
        canvas.translate(2f * density, 2f * density)
        canvas.scale(scale, scale)
        canvas.drawPath(path, fill)
        canvas.drawPath(path, stroke)
        canvas.restore()
    }

    private companion object {
        const val SIZE_DP = 34
    }
}
