<script setup lang="ts">
/**
 * Deskvue kernel
 * 内核服务组件模块 DvTerminal 终端，输入输出缓冲区 /sys/buffer 的显示界面
 * 被 内核服务 DvCliKernelService 和 系统程序 DvShell 调用
 */

import {
    ref,
    computed,
    watch,
    onMounted,
    onUnmounted,
    nextTick,
    inject,
    type ComputedRef,
    type ShallowRef,
} from 'vue'
import { dvTriggerKernelError } from '../../../../error'
import type {
    DvDirInode,
    DvFsInodeCreateOptions,
    DvFsInodeMemStruct,
    DvFsLsItem,
    DvFsMemStruct,
    DvFsProgramMeta,
    DvInodeHandler,
    DvProcess,
    DvProgramRegInode,
    DvRegInode,
    useDvFsIpath,
} from '../../../../fs'
import { DV_OS_PROVIDE, type DvOsProvide } from '../../../types'
import type { DvIoOutputRow } from '../../../utils'

defineOptions({
    name: 'DvTerminal',
})

//DvOs injection
const osInjects = inject(DV_OS_PROVIDE, {} as DvOsProvide)
const { stageHook, logo, ioBuffer } = osInjects

//props
export interface DvTerminalProps {
    fsize?: number
    tabw?: number
}
const props = withDefaults(defineProps<DvTerminalProps>(), {
    fsize: 14,
    tabw: 4,
})

//buffer html
const bufferHtml = computed<string>(() => {
    const html: string[] = []
    if (ioBuffer.value.length <= 0) return ''
    for (const row of ioBuffer.value) {
        //output
        if ((row as DvIoOutputRow).cells !== undefined) {
            const out = row as DvIoOutputRow
            if (out.html && out.html !== '') {
                html.push(out.html)
            } else {
                html.push('<div class="dv-buffer-row"></div>')
            }
        }
    }
    //ready 阶段后，显示 用户输入光标
    html.push('<div class="dv-buffer-row"><span class="dv-buffer-cell cursor"></span></div>')
    return html.join('')
})
</script>
<template>
    <div class="dv-terminal" v-html="bufferHtml"></div>
</template>
