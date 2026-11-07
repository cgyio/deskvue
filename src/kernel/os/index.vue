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
import { ref, computed, onMounted, onUnmounted, nextTick, provide, type ShallowRef } from 'vue'
import { useDvProgramHook, type DvProgramComponentProps } from '../utils'
import type {
    DvDirInode,
    DvFsInodeCreateOptions,
    DvFsMemStruct,
    DvFsProgramMeta,
    DvProgramRegInode,
    DvRegInode,
} from '../fs'
import { useDvFsIpath } from '../fs'
import { DV_OS_PROVIDE } from './types'
import { dvTriggerKernelError, DvKernelError } from '../error'
import { useDvDarkHook } from './hooks'
import { dvIs, dvExtend, dvWait } from '@utils/core'

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
const dvProgram = useDvProgramHook(() => props)
const { pid, ipath, inode, handler, callCtx, memory, sysCall } = dvProgram
const { isDark, toggleDark } = useDvDarkHook()
//程序私有内存
const mem = memory.value

//DvKernel.stage
const { stage, errors, prints } = globalThis.DvKernel
//内核启动阶段的字符输出内容
const printHtml = computed<string>(() => {
    const html: string[] = [
        '<div class="dv-kernel-logo">',
        '<img src="',
        `https://ms.systech.work/src/icon/deskvue-logo-expand${isDark.value ? '-dark' : ''}.svg" `,
        'style="height: 64px;width: auto;">',
        '</div>',
    ]
    for (const s of prints.value) {
        let cls: string[] = []
        let lbl: string = ''
        let str: string = s

        //截取 class
        if (str.startsWith('[.') && str.includes(']')) {
            const sa = str.slice(2).split(']')
            if (sa.length < 2 || !sa[0] || !sa[1]) continue
            cls = sa[0].split('.')
            str = sa[1]
        }
        //截取 label
        if (str.includes('：')) {
            const sa = str.split('：')
            if (sa.length < 1 || !sa[0]) continue
            lbl = sa[0] + '：'
            str = sa.slice(1).join('：')
        }

        const h: string[] = ['<div']
        if (cls.length > 0) {
            h.push(` class="${cls.join(' ')}">`)
        } else {
            h.push('>')
        }
        if (lbl !== '')
            h.push(`<span class="dv-kernel-label">${lbl}</span><span class="dv-flex-1">`)
        h.push(str)
        if (lbl !== '') h.push('</span>')
        h.push('</div>')

        html.push(h.join(''))
    }
    //光标
    html.push('<div class="dv-kernel-cursor"></div>')
    html.push('<div></div>')
    return html.join('')
})

//!! 承接 kernel.start 方法，继续内核启动流程
//!! 在 onMounted 内部执行，统一包裹在 try-catch 中，出错报内核错误
//  5   os-mounting：DvOs 根组件挂载，创建 FS 根目录结构
const osMounting = async (): Promise<void> => {
    const baseDir = sysCall('fs:open', '/') as DvDirInode
    const sysDir = sysCall('fs:open', '/sys') as DvDirInode
    if (!baseDir || !sysDir) {
        throw new DvKernelError('发生内核错误，未找到系统根目录')
    }
    //创建系统目录结构
    const srvDir = await sysDir.mkdir('service', { owner: 'root' }, callCtx.value)
    if (srvDir) prints.value.push(`系统目录已创建：/sys/service`)
    const prgDir = await baseDir.mkdir('program', { owner: 'root' }, callCtx.value)
    if (prgDir) prints.value.push(`系统目录已创建：/program`)
    const sds = 'user,dev,mnt,run'.split(',')
    const cderr: string[] = []
    for (const k of sds) {
        const hdl = await baseDir.mkdir(k, { owner: 'root' }, callCtx.value)
        if (!hdl) {
            cderr.push(k)
        } else {
            prints.value.push(`系统目录已创建：/${k}`)
        }
    }
    if (!srvDir || !prgDir || cderr.length > 0) {
        if (!srvDir) cderr.push('sys/service')
        if (!prgDir) cderr.push('program')
        throw new DvKernelError(`发生内核错误，无法创建系统目录结构 ${cderr.join(',')}`)
    }

    //未能成功挂载的程序、服务、系统文件 名称
    const errs: string[] = []

    //开始挂载程序节点
    const progs = globalThis.DvApp.config.globalProperties.$programs ?? {}
    //将标记为 service 的组件，挂载到 /sys/service 下
    const srvs = {
        sys: progs?.sys?.services ?? {},
        lib: progs?.lib?.services ?? {},
    }
    //将标记为 program 的组件，挂载到 /program 下
    const prgs = {
        sys: progs?.sys?.programs ?? {},
        lib: progs?.lib?.programs ?? {},
    }
    //系统程序和服务，必须存在
    if (!(srvs.sys && dvIs.nemobj(srvs.sys)) || !(prgs.sys && dvIs.nemobj(prgs.sys))) {
        throw new DvKernelError('发生内核错误，未发现任何系统服务程序')
    }

    //程序节点挂载方法
    const mnt = async (
        handler: DvDirInode,
        pgs: Record<string, DvFsProgramMeta>,
        opts?: Partial<DvFsInodeCreateOptions>,
    ): Promise<void> => {
        if (!pgs || !dvIs.nemobj(pgs)) return
        opts = dvExtend(
            false,
            {
                mode: 'reg',
                type: 'program',
            },
            opts,
        )
        for (const k in pgs) {
            const srvMeta = pgs?.[k] as DvFsProgramMeta
            if (!srvMeta || !srvMeta.name) {
                errs.push(srvMeta.name ?? k)
                continue
            }
            //创建程序节点
            const opti = dvExtend(
                false,
                {
                    inode: {
                        //程序节点每次启动时重建，不需要记录时间戳
                        time: { a: 0, c: 0, m: 0, d: 0 },
                        name: srvMeta.title ?? srvMeta.name,
                        extra: {
                            component: srvMeta.name,
                        },
                    },
                },
                opts,
            )
            const hdl = await handler.create(srvMeta.name, opti, callCtx.value)
            if (!hdl) {
                errs.push(srvMeta.name)
                continue
            } else {
                //print
                const issrv = srvMeta.isService ?? false
                prints.value.push(
                    `${issrv ? '服务' : '程序'}已安装：${issrv ? '/sys/service' : '/program'}/${srvMeta.name}`,
                )
            }
        }
    }

    //挂载系统服务程序
    await mnt(srvDir, srvs.sys, {
        auth: 101,
        owner: 'root',
    })
    await mnt(prgDir, prgs.sys, {
        auth: 101,
        owner: 'user',
    })
    //挂载业务服务程序
    if (srvs.lib && dvIs.nemobj(srvs.lib)) {
        await mnt(srvDir, srvs.lib, {
            auth: 111,
            owner: 'user',
        })
    }
    if (prgs.lib && dvIs.nemobj(prgs.lib)) {
        await mnt(prgDir, prgs.lib, {
            auth: 111,
            owner: 'user',
        })
    }

    //创建 /sys/config|update 系统文件
    const sysfs: PlainObject = {
        config: '*.conf',
        update: '*.upd',
    }
    for (const k in sysfs) {
        const ext = sysfs?.[k]
        if (!ext) {
            errs.push(`sys/${k}`)
            continue
        }
        const hdl = await sysDir.create(
            k,
            {
                mode: 'reg',
                type: 'ext',
                auth: 101,
                owner: 'root',
                inode: {
                    time: { a: 0, c: 0, m: 0, d: 0 },
                    extra: {
                        mime: ext,
                    },
                },
            },
            callCtx.value,
        )
        if (!hdl) {
            errs.push(`sys/${k}`)
            continue
        } else {
            //print
            prints.value.push(`系统文件已创建：${ext}：/sys/${k}`)
        }

        //TODO：从 dvHdd 读取持久化的 config|update 内容，填充到 inode._icache_.content
        //下一阶段拉起系统服务时，可能需要读取配置参数
        //...
    }

    //存在错误
    if (errs.length > 0) {
        throw new DvKernelError(
            `发生内核错误，有服务、程序、系统文件未能正确挂载：${errs.join(',')}`,
        )
    }

    //内核状态 os-mounting -> fs-ready
    stage.stageNext()
    await dvWait(10)
}
//  6   fs-ready：开始批量拉起 owner = root 的内核服务程序
const fsReady = async (): Promise<void> => {
    const srvDir = sysCall('fs:open', '/sys/service') as DvDirInode
    if (!srvDir) {
        throw new DvKernelError('发生内核错误，未找到系统服务目录')
    }
    //节点数据
    const srvInode = srvDir.inode
    const ipu = useDvFsIpath()
    const srvs = Object.keys(srvInode).filter((i: string) => {
        if (ipu.isFid(i) !== true) return false
        const inode = srvInode[i] as DvFsMemStruct
        if (!inode) return false
        return inode._inode_.owner === 'root'
    })
    if (srvs.length <= 0) {
        throw new DvKernelError('发生内核错误，未找到任何系统服务程序')
    }
    //批量拉起
    const pids: Record<string, string> = {}
    const errs: string[] = []
    for (const k of srvs) {
        const pid = await sysCall('fs:exec', `/sys/service/${k}`)
        if (!pid) {
            errs.push(k)
            continue
        }
        pids[k] = pid
    }

    //存在错误
    if (errs.length > 0) {
        throw new DvKernelError(`发生内核错误，有系统服务未能正确启动：${errs.join(',')}`)
    }

    //内核状态 fs-ready -> service-ready
    stage.stageNext()
    await dvWait(10)
}
//  7   service-ready：所有系统服务已启动
const serviceReady = async (): Promise<void> => {
    //内核状态 service-ready -> os-ready
    //  跳转 os-ready 触发 DvUacService 渲染登录界面
    //  内核启动阶段推进 转移到 DvUacService 组件内部
    stage.stageNext()
    await dvWait(10)
}

//onMounted
onMounted(async () => {
    //继续内核启动流程
    //os-mounting --> os-ready 阶段
    try {
        await osMounting()
        //await fsReady()
        //await serviceReady()
    } catch (e: any) {
        //os-mounting --> os-ready 阶段发生错误，一律内核 panic
        dvTriggerKernelError(e, 'PANIC')
    }
})

provide(DV_OS_PROVIDE, {
    stage: stage.stage,

    isDark,
    toggleDark,
})

//定义根组件实例类型
export interface DvOsExposed {
    //initService: () => Promise<void>
}
defineExpose<DvOsExposed>({
    //initService,
})
</script>
<template>
    <div v-if="stage.stageBefore('os-ready')" class="dv-kernel" v-html="printHtml"></div>
</template>
