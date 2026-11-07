<script setup lang="ts">
/**
 * DvCliService 命令行组件
 * 内核级别的 service，全局单例，自启动，早于用户登录
 *
 */
import { ref, computed, inject, onMounted, nextTick } from 'vue'
import {
    dvTriggerKernelError,
    type DvFsProgramMeta,
    useDvProgramHook,
    type DvProgramComponentProps,
    DV_OS_PROVIDE,
    type DvOsProvide,
} from '@/kernel'
import {
    useDvCmdHook,
    type DvCmdBuffer,
    type DvCmdTerminalConfig,
    dvCmdTerminalConfig,
} from './hooks/useDvCmdHook'

defineOptions({
    name: 'DvCliService',
    programMeta: {
        name: 'DvCliService',
        title: '命令行服务',
        desc: 'Deskvue 系统的命令行服务',
        isService: true,
        mimes: ['*.cli'],
    } as DvFsProgramMeta,
})

//根组件 props，通过 start 启动方法第二参数 options.os{} 传入
export interface DvOsProps extends DvProgramComponentProps {
    //!! 所有 program 组件必须定义
    pid: string
}
const props = withDefaults(defineProps<DvOsProps>(), {})

//
//私有内存结构
export interface DvCliServiceMemStruct extends PlainObject {
    pid: string
    //命令行终端显示参数
    terminal: DvCmdTerminalConfig
    //缓存当前会话中 所有命令行输入输出的数据
    buffer: DvCmdBuffer
}

//hook
const dvProgram = useDvProgramHook<DvCliServiceMemStruct>(() => props)
const { pid, ipath, inode, handler, callCtx, memory, sysCall } = dvProgram
const dvCmd = useDvCmdHook(() => dvProgram)

//inject
const osInjects = (inject(DV_OS_PROVIDE, null) ?? {}) as DvOsProvide
if (!osInjects) {
    dvTriggerKernelError('发生内核错误，未获取到根组件 Provide 数据', 'OOPS')
}
const { stage, isDark } = osInjects

//onMounted|onUnmounted
onMounted(async () => {
    await nextTick()

    //构建私有内存结构
    if (!memory.value?.terminal) memory.value.terminal = { ...dvCmdTerminalConfig }
    if (!memory.value?.buffer) memory.value.buffer = []
})
</script>
