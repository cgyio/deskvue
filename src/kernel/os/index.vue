<script setup lang="ts">
/**
 * Deskvue kernel
 * 在浏览器环境下模拟 Linux 系统的部分行为
 *
 * Deskvue 根组件 DvOs，作为 /sys/prog0 程序(0 号进程)的指向组件
 * 内核启动到 os-start 阶段：
 *      通过 createApp(DvOs) 创建根组件实例
 *      实例会被挂载到 globalThis.DvOS 作为全局唯一根组件实例
 * 内核启动到 os-mounting 阶段：
 *      此时内存 FS 文件系统根路径(dvMem.fs)，/sys，/sys/prog0 文件节点已生成
 *      /sys/prog0 已手动启动
 *      执行 app.mount(#el) 挂载根组件
 *      !! 后续内核启动步骤转到此组件内部
 *
 */
import {
    ref,
    computed,
    watch,
    onMounted,
    onUnmounted,
    nextTick,
    provide,
    type ComputedRef,
    type ShallowRef,
} from 'vue'
import {
    useDvProgram,
    type DvProgramComponentProps,
    useDvFlusher,
    useDvIoBuffer,
    useDvServiceWatcher,
    useDvInstaller,
    useDvOsProvider,
    type DvOsServiceExposed,
} from './utils'
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
} from '../fs'
import { useDvFsIpath } from '../fs'
import { DV_OS_PROVIDE, type DvOsProvide } from './types'
import { dvTriggerKernelError, DvKernelError } from '../error'
import { dvIs, dvExtend, dvWait, dvDateStr } from '@utils/core'
import DvKernelUi from './modules/dv-kernel-ui.vue'
import DvTerminal from './service/dv-cli/modules/dv-terminal.vue'

defineOptions({
    name: 'DvOs',
    //所有 program 程序组件必须定义
    programMeta: {
        name: 'DvOs',
        title: 'Deskvue',
        isService: false,
        isSysProgram: false,
        isMultiple: false,
        mimes: ['*.conf', '*.upd'],
    } as DvFsProgramMeta,
})

//根组件 props，通过 start 启动方法第二参数 options.os{} 传入
export interface DvOsProps extends DvProgramComponentProps {
    //!! 所有 program 组件必须定义
    pid: string
}
const props = withDefaults(defineProps<DvOsProps>(), {})

//hook
//const ipu = useDvFsIpath()
//程序基础 hook
const dvProgram = useDvProgram(() => props)
const { sysCall, callService } = dvProgram
//刷盘调度器
const dvFlusher = useDvFlusher(() => dvProgram)
const { startIntervalFlush, stopIntervalFlush } = dvFlusher
//系统服务守卫
const dvSrvWatcher = useDvServiceWatcher(() => dvProgram)
const {
    //services,
    //serviceAutoStartSequence,
    createKernelServiceInodes,
    createServiceInodes,
    autoStartServices,
    awaitAutoStartServicesMounted,
    exposed: serviceExposed,
} = dvSrvWatcher
//程序安装器
const dvInstaller = useDvInstaller(() => dvProgram)
const { createProgramInodes, installUserProgram } = dvInstaller

//DvKernel.stage
const { stage, errors, options } = globalThis.DvKernel

//!! 承接 kernel.start 方法，继续内核启动流程
//!! 在 onMounted 内部执行，统一包裹在 try-catch 中，出错报内核错误
//  5   os-mounting：DvOs 根组件挂载，挂载 内核服务，已收集到的 系统|用户 程序|服务
//      服务全部注册到 services，出错抛内核错误
const osMounting = async (): Promise<void> => {
    //挂载 内核服务
    await createKernelServiceInodes()
    stage.updateStageProgressInQueue(30, 3, 0)
    //挂载 已收集到的 系统|用户 服务
    await createServiceInodes()
    stage.updateStageProgressInQueue(30, 3, 1)
    //挂载 已收集到的 系统|用户 程序
    await createProgramInodes()
    stage.updateStageProgressInQueue(30, 3, 2)

    //!! 删除 globalProperties.$programs
    delete globalThis.DvApp.config.globalProperties.$programs

    //内核状态 os-mounting -> fs-ready
    stage.stageNext()
    await dvWait(10)
}
//  6   fs-ready：开始批量拉起 serviceInfo.autoStart == true 的服务程序
const fsReady = async (): Promise<void> => {
    //读取服务注册表 services 批量拉起 serviceInfo.autoStart == true 的服务程序
    const srvok = await autoStartServices()
    if (srvok) {
        //等待所有服务 mounted
        const mntok = await awaitAutoStartServicesMounted()
        if (mntok) {
            stage.setStageProgress(45)

            //内核状态 fs-ready -> service-ready
            stage.stageNext()
            await dvWait(10)
        }
        //!! 等待超时会报内核错误
    }
    //!! 系统服务未就绪 会报内核 panic
}
//  7   service-ready：所有系统服务已启动
const serviceReady = async (): Promise<void> => {
    //console.log('serviceReady')
    await callService('cli', 'ioPrint', 'Services Ready')
    await callService('cli', 'ioPrint', '')
    await callService('cli', 'ioPrint', 'Deskvue Kernel Ready')
    await callService('cli', 'ioPrint', '')
    await callService('cli', 'ioPrint', 'Uac Login Starting')
    //内核状态 service-ready -> os-ready
    //  跳转 os-ready 触发 DvUacService 渲染登录界面
    //  内核启动阶段推进 转移到 DvUacService 组件内部
    stage.stageTo('os-ready')
    await dvWait(10)
}

//onMounted
onMounted(async () => {
    await nextTick()

    //继续内核启动流程
    //os-mounting --> os-ready 阶段
    try {
        await osMounting()
        await fsReady()
        await serviceReady()

        //!! panic 测试，蓝屏
        //throw new DvKernelError('手动模拟内核崩溃', { level: 'PANIC' })
    } catch (e: any) {
        //os-mounting --> os-ready 阶段发生错误，一律内核 panic
        dvTriggerKernelError(e, 'PANIC')
    }
})

//provide 向子组件暴露
const { env, isDark, toggleDark, logo } = useDvOsProvider(() => dvProgram)
provide(DV_OS_PROVIDE, {
    stage: stage.stage,
    stageHook: stage,

    service: serviceExposed,

    install: installUserProgram,

    env,

    //ioBuffer,
    //sysConfig,
    //userSession,

    isDark,
    toggleDark,
    logo,
})

//定义根组件实例类型
export interface DvOsExposed {
    sysCall: (cmd: string, ...args: any[]) => any
    service: DvOsServiceExposed
}
defineExpose<DvOsExposed>({
    sysCall,
    service: serviceExposed,
})
</script>
<template>
    <!-- 启动阶段显示 -->
    <DvKernelUi v-if="stage.stageBefore('ready')" height="30vh"></DvKernelUi>
    <!-- 挂载 服务组件 -->
    <template v-if="stage.stageAfter('fs-ready', true)">
        <template
            v-for="(srvi, srvn) of serviceExposed.services.value"
            :key="`deskvue_service_${srvn}`"
        >
            <component
                v-if="serviceExposed.isMountable(srvi.ipath)"
                :is="srvi.name"
                :pid="srvi.pid"
                v-bind="srvi.props"
            ></component>
        </template>
    </template>
    <!-- panic 蓝屏-->
    <div v-if="stage.stageIs('kernel-panic-error')" class="dv-panic">
        {{ stage.stageErrorMsg.value }}
    </div>
</template>
