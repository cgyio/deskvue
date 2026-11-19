<script setup lang="ts">
/**
 * DvOs 根组件模块
 * 在系统桌面准备完成之前，显示系统启动以及登录状态 界面
 * 被 DvOs 根组件以及内核服务 DvCliKernelService, DvUacKernelService 使用
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
import { dvTriggerKernelError } from '../../error'
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
} from '../../fs'
import { DV_OS_PROVIDE, type DvOsProvide } from '../types'

defineOptions({
    name: 'DvKernelUi',
})

//DvOs injection
const osInjects = inject(DV_OS_PROVIDE, {} as DvOsProvide)
const { stageHook, logo } = osInjects

//props
interface DvOsKernelUiProps {
    height: string
}
const props = withDefaults(defineProps<DvOsKernelUiProps>(), {
    height: '30vh',
})
</script>
<template>
    <div class="dv-kernel-ui dv-flex-y-cc">
        <div class="dv-flex-2"></div>
        <img :src="logo.expand" alt="Deskvue" style="height: 48px; width: auto" />
        <div class="dv-kernel-content" :style="{ height: props.height }">
            <slot></slot>
        </div>
        <div class="dv-kernel-progress">
            <div
                class="progress-bar"
                :style="{
                    width: `${stageHook.stageProgress.value}%`,
                }"
            ></div>
        </div>
        <div class="dv-flex-1"></div>
    </div>
</template>
