/**
 * Deskvue kernel
 * DvOs hook
 *
 * 基于 vueuse 处理暗黑模式
 */

import { ref, reactive, computed, watch, onMounted, nextTick, provide } from 'vue'
import { useDark, useToggle } from '@vueuse/core'
import { dvWait } from '@utils/core'

export const useDvDarkHook = () => {
    //isDark
    const isDark = useDark()
    //dark 切换标记
    const darkToggling = ref<boolean>(false)
    //dark 切换
    const darkToggleDura = ref<number>(300)
    //dark 切换 mask 背景色|前景色
    const darkMaskBgc = ref<string>('')
    const darkMaskFc = ref<string>('')
    const darkMaskAlpha = ref<number>(0.9)
    const toggleDark = async (to?: boolean): Promise<void> => {
        if (darkToggling.value || (to !== undefined && to === isDark.value)) return
        const dura = darkToggleDura.value
        //显示 mask
        darkMaskBgc.value = `rgba(${isDark.value ? '229,229,229' : '26,26,26'}, ${darkMaskAlpha.value})`
        darkMaskFc.value = isDark.value ? '#000' : '#fff'
        darkToggling.value = true
        //等待 mask 显示完成
        await dvWait(dura)
        //切换
        isDark.value = to !== undefined ? to : !isDark.value
        await dvWait(dura * 2)
        //隐藏 mask
        darkToggling.value = false
    }

    return {
        isDark,
        darkToggling,
        darkToggleDura,
        darkMaskBgc,
        darkMaskFc,
        darkMaskAlpha,

        toggleDark,
    }
}
