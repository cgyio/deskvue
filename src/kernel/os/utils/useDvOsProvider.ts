/**
 * Deskvue kernel
 * 由 根组件 DvOs 使用， 向全局 provide 数据
 *
 */

import { ref, reactive, computed, watch, onMounted, nextTick, provide } from 'vue'
import { useDark, useToggle } from '@vueuse/core'
import { DvKernelError } from '../../error'
import {
    useDvMemStore,
    useDvFsIpath,
    type DvFsMemStruct,
    type DvFsProgramMeta,
    type DvInodeHandler,
    type DvFsInodeCreateOptions,
    type DvProcess,
} from '../../fs'
import { type DvProgramHookGetter } from './useDvProgram'
import { dvIs, dvExtend, dvCopy, dvWait } from '@/utils'

//输出的 logo 数据格式
export type DvLogoProvide = {
    origin: string
    square: string
    expand: string
}

export const useDvOsProvider = (hookGetter: DvProgramHookGetter) => {
    //全局 暗黑模式
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

    //logo
    //根据 sysConfig 以及 userSession 登录状态，获取当前的系统 logo 字符串
    //  origin  原始字符，可能包含 ${expand} ${dark} 占位符
    const logo = computed<DvLogoProvide>(() => {
        const hook = hookGetter()
        let origin =
            globalThis.DvKernel.stage.stageAfter('is-login', true) &&
            hook.userSession.value !== undefined
                ? hook.userSession.value.iso.logo
                : hook.sysConfig.value.service.gui.dvLogo
        if (!origin || !dvIs.nemstr(origin)) {
            //!! 默认 logo
            origin = 'https://ms.systech.work/src/icon/deskvue-logo${expand}${dark}.svg'
        }
        //适应当前 dark 模式，生成 方形|展开 两种形态的 logo
        const dl = origin.replace('${dark}', isDark.value ? '-dark' : '')
        return {
            origin,
            square: dl.replace('${expand}', ''),
            expand: dl.replace('${expand}', '-expand'),
        }
    })

    return {
        isDark,
        darkToggling,
        darkToggleDura,
        darkMaskBgc,
        darkMaskFc,
        darkMaskAlpha,
        toggleDark,

        logo,
    }
}
