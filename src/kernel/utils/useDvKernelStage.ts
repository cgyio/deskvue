/**
 * Deskvue kernel
 * Deskvue 内核启动 stage 状态机
 */

import { ref, computed } from 'vue'
import { useDvStage, dvIs } from '@/utils'
import { DvKernelError } from '../error'

//定义 Deskvue 内核的 启动状态序列
//!! 单向，线性
const dvKernelStages = [
    //内核初始化开始 标记
    'booting',

    //createApp(DvOs) 创建 Vue 全局根 app，后续的 pinia 初始化需要 app 实例
    'os-start',

    //FS 文件系统初始化开始
    //  pinia 初始化
    //  在从 dvHdd 磁盘中读取文件系统目录结构，挂载到 dvMem 内存文件树
    //  启动 /sys/prog0 跟程序(0 号进程)，后续所有对系统文件的读写，通过此程序
    //      /sys/prog0 程序指向 Vue 根组件 DvOs
    //      !! 手动启动 /sys/prog0 进程（创建 pid ，挂载 program[pid] | pidCache[pid]）
    //      !! 手动修改 prog0Node._icache_{ handler, meta, program[pid] }
    //      !! DvOs 的外部启动参数 options.os 中添加 pid 参数
    'fs-initing',

    //Vue plugin install 以及 业务库注册
    //  执行 kernel-service 组件全局注册，按顺序收集到 globalProperties.$service
    //  执行 Vue plugin.install 注册所有全局组件，注册所有 v-* 全局指令，注册全局方法
    //  读取启动参数中的 options.lib 加载所有外部的业务组件库，注册业务库的全局组件
    //  扫描全局组件，筛选 program | service 类型组件
    //  !! 得到的 program | service 列表挂到 DvApp.config.globalProperties.$program.sys|lib
    'os-initing',

    //DvOs 根组件挂载
    //  !! app.mount(#el) 开始挂载 DvOs 界面，显示内核启动画面：字符显示 程序与服务列表，进度 等
    //  !! 内核启动阶段推进 转移到 DvOs 组件内部
    //  DvOs 组件 onMounted 中：
    //      将组件实例添加到 programInstance[pid]
    //      !! prog0.sysCall(...) 创建 系统|用户 的 服务|程序 节点
    'os-mounting',

    //FS 文件系统初始化完成，文件系统就绪
    //  sysCall 权鉴通道开始生效，program 可在组件内部正常调用 sysCall
    //      !! 此时用户还未登录，因此只有 root用户 + 系统程序 可以通过权鉴
    //  /sys/prog0 进程内部开始批量拉起 owner = root 的内核服务程序：
    //
    //      sysCall('fs:exec', '/sys/service/DvCliService')
    //      sysCall('fs:exec', '/sys/service/DvGuiService')
    //      sysCall('fs:exec', '/sys/service/DvWinService')
    //      sysCall('fs:exec', '/sys/service/DvUacService')
    //      ...
    //
    //      ... GUI 服务启动，开始监听 pidItems | winItems 进程列表
    //
    //      DvKernel.stage.stageNext()
    'fs-ready',

    //所有核心服务启动完成，后续的自启程序转由对应的 service 负责拉起
    //  DvCliService 内部维护一个全局的 console 控制台
    //  DvWinService 内部监听 dvMem.winItems[] 动态渲染窗口组件
    //  ...
    //  DvKernel.stage.stageNext()
    'service-ready',

    //内核态发生 panic 级别错误，DvOs 显示蓝屏
    'kernel-panic-error',

    //内核启动完成，开始进入用户态
    //  !! 此状态之前如果发生错误，都属于内核错误，panic
    //  !! 此状态之后如果发生错误，属于普通错误，可通过 DvWinService 正常渲染错误提示窗口，不会 panic
    //  DvUacService 内部启动登录程序：
    //      sysCall('fs:exec', '/program/DvLoginer')
    //      DvKernel.stage.stageNext()
    'os-ready',

    //登录程序启动，渲染登录界面
    //  等待用户输入账号密码，渲染错误信息
    //  如果最终登录失败，跳转到 login-error
    //  登录成功后，跳转到 user-initing
    'login-start',

    //登录失败
    //  渲染登录失败画面，冷却时间，要求用户重启(刷新页面)
    //  后续代码不继续，*-error 是终态
    'login-error',

    //登录成功，开始加载用户数据
    //  dvLoginerHandler.close() 退出登录界面
    //  此阶段还没有生成 /sys/session 会话文件，所有操作仍通过 /sys/prog0 执行：
    //      sysCall('fs:open', '/sys').create('session', {... 写入用户信息 ...})
    //          DvTaskbar 组件会动态渲染用户头像，已登录状态图标
    //  执行 await app.config.globalProperties.$setupBzLibs() 所有业务库的 setup 方法
    //      需要用户登录信息来自 /sys/session
    //      业务库 setup 完成后，/sys/prog0 调用 sysCall 修剪 /sys/service、/program
    //          !! 业务库提供的 service 只能是 owner = user 的用户服务，不会自启动，需要用户手动拉起
    //          业务库的 program 程序也只能是 owner = user 的用户程序
    //          如果当前登录的用户无权执行某些程序，会从 /program、/sys/service 删除节点
    //  最后通过 /sys/prog0 执行 sysCall('fs:user_init') 用户初始化动作，其中会执行：
    //      读取持久化的用户数据 dvHdd.fs.user.[uSign] 合并到内存文件树中
    //          覆盖 /sys/config、/sys/update 等文件
    //          修剪 /sys/service、/program 程序列表
    //              !! 加载用户自行安装的程序服务，其 owner = 当前用户的 iso:uuid
    //          生成固定的用户目录下的文件：
    //              /user/desktop/*.shortcut|*.widget|*.*   桌面上要显示的图标小组件等
    //              /user/taskbar/*.shortcut                任务栏上的快速启动图标
    //              /user/autoexec/*.shortcut               需要自启动的用户程序
    //
    //  !! 以上任意步骤发生错误，会跳转到 user-error 状态
    //  如果一切正常，跳转到 is-login
    'user-initing',

    //用户数据加载失败
    //  渲染失败画面，要求用户重启(刷新页面)
    //  后续代码不继续，*-error 是终态
    'user-error',

    //所有用户数据加载完成后，标记为 is-login
    //  至此，Deskvue 内核、DvOs 根组件、桌面环境、用户配置全部准备完成
    //  !! 此后所有的 program 都可以在内部正常通过 sysCall 调用内核接口，调用上下文也可以正常传递
    //  DvGuiService 内部监听状态为 is-login 后，拉起基础的壳程序，这些程序 owner = user：
    //      sysCall('fs:exec', '/program/DvDesktop')
    //          程序内部读取 /user/desktop/* 目录下的 shortcuts|widgets|任意桌面reg文件
    //          动态渲染这些文件的图标 以及 小组件
    //      sysCall('fs:exec', '/program/DvTaskbar')
    //          程序内部 sysCall('session:read') 获取登录用户信息，渲染用用户头像
    //          读取 /user/taskbar/* 目录下的 shortcuts 动态渲染为任务栏常驻图标
    //      sysCall('fs:exec', '/program/DvLauncher')
    //          程序内部读取 /user/autoexec/* 目录下的 shortcuts
    //          依次启动这些用户标记为自启动的程序 sysCall('fs:exec', '/program/*')
    //          !! 一定是先拉起 service 服务，再拉起 program
    //          !! 这里拉起的一定是 owner = user 的用户程序和服务
    //  !! 这里如果出错，正常通过 DvWinService 渲染错误提示，无需重启，可以直接忽略
    //  一切正常 DvKernel.stage.stageNext()
    'is-login',

    //Deskvue 启动流程结束，进入最终态 ready 标记
    //!! 这是整个启动流程的最终态，Deskvue 启动完成
    'ready',
] as const
export type DvKernelStage = (typeof dvKernelStages)[number]
//各 stage 阶段提示语
const dvKernelStageTitles: Record<DvKernelStage, string> = {
    booting: '开始引导',
    'os-start': '系统开始启动',
    'fs-initing': '文件系统初始化',
    'os-initing': '系统初始化',
    'os-mounting': '构建目录与程序',
    'fs-ready': '文件系统就绪',
    'service-ready': '系统服务就绪',
    'kernel-panic-error': '内核崩溃',
    'os-ready': '系统就绪',
    'login-start': '用户登录',
    'login-error': '登录失败',
    'user-initing': '加载用户数据',
    'user-error': '用户数据加载失败',
    'is-login': '用户已登录',
    ready: '就绪',
}
//各 *-error 错误阶段的 icon 和 msg
const dvKernelErrorStageGuis: Record<string, { icon: string; msg: string }> = {
    'kernel-panic-error': {
        icon: '',
        msg: 'Deskvue 内核崩溃',
    },
    'login-error': {
        icon: 'md-round-sentiment-very-dissatisfied',
        msg: '登录失败，无法进入系统',
    },
    'user-error': {
        icon: 'md-round-report-gmailerrorred',
        msg: '无法加载用户数据，无法进入系统',
    },
}

//定义状态机
export const useDvKernelStage = () => {
    const hook = useDvStage<DvKernelStage>({
        queue: [...dvKernelStages],
        title: dvKernelStageTitles,

        //onChange
        onChange: (from: DvKernelStage, to: DvKernelStage, queue: DvKernelStage[]) => {
            //login-error 需要设置 msg/icon
            if (to === 'login-error') {
                stageErrorIcon.value = 'md-round-sentiment-very-dissatisfied'
                stageErrorMsg.value = '登录失败，无法进入系统'
            }
        },
    })

    //当 stage 跳转到 *-error 时，显示的错误 icon
    const stageErrorIcon = ref<string>('md-round-report-gmailerrorred')
    //当 stage 跳转到 *-error 时，显示的错误信息
    const stageErrorMsg = ref<string>('')
    //任意状态 跳转到 *-error
    const stageToError = (to: DvKernelStage, msg: string): void => {
        if (!to.endsWith('-error')) return
        const gui = dvKernelErrorStageGuis?.[to] ?? { icon: 'md-round-close', msg: 'Unknown Error' }
        const msga: string[] = msg.split('::')

        stageErrorIcon.value = msga[0] && dvIs.nemstr(msga[0]) ? msga[0] : gui.icon
        stageErrorMsg.value = msga[1] && dvIs.nemstr(msga[1]) ? msga[1] : gui.msg
        hook.stageTo(to)
    }

    //更具体的 stage 判断，用于快速判断，以及在 DvOs 组件内显示相应的界面
    //判断是否可以使用 FS 权鉴
    const isAcAvailable = computed<boolean>(() => {
        if (hook.stageIs('os-initing', 'os-mounting')) return true
        return hook.stageAfter('fs-ready', true)
    })
    //内核启动是否完成，决定抛出的错误是否 panic
    const isKernelReady = computed<boolean>(() => hook.stageAfter('os-ready', true))
    //DvOs 按阶段显示画面
    //是否显示 logo
    const isLogoStage = computed<boolean>(() => hook.stageAfter('os-mounting', true))
    //是否服务启动阶段
    const isServiceStage = computed<boolean>(() => hook.stageAfter('fs-ready', true))
    //是否开始渲染桌面阶段
    const isDesktopStage = computed<boolean>(() => hook.stageAfter('service-ready', true))
    //是否显示登录界面阶段
    const isLoginStage = computed<boolean>(() => {
        return hook.stageBetween('os-ready', 'user-initing')
    })

    //启动阶段进度条进度值
    const stageProgress = ref<number>(0)
    const setStageProgress = (to: number): void => {
        const n = to < 0 ? 0 : to > 100 ? 100 : to
        stageProgress.value = n
    }
    //进度增加
    const updateStageProgress = (n: number): void => {
        const np = stageProgress.value + n
        stageProgress.value = np > 100 ? 100 : np < 0 ? 0 : np
    }
    //进度递增
    const updateStageProgressInQueue = (
        to: number, //进度增加到
        length: number, //一共要增加几次
        cidx: number = 0, //当前已经增加到第几次，从 0 开始
    ): void => {
        const op = stageProgress.value
        const len = length - cidx - 1
        if (len <= 0) return
        //每次增加值
        const dv = (to - op) / len
        return updateStageProgress(dv)
    }

    return {
        ...hook,

        stageErrorIcon,
        stageErrorMsg,
        stageToError,

        isAcAvailable,
        isKernelReady,
        isLogoStage,
        isServiceStage,
        isDesktopStage,
        isLoginStage,

        stageProgress,
        setStageProgress,
        updateStageProgress,
        updateStageProgressInQueue,
    }
}

//stage 工具类型
export type DvKernelStageHook = ReturnType<typeof useDvKernelStage>
