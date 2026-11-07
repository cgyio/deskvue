/**
 * Deskvue kernel
 * Deskvue 模拟 Linux 文件系统的部分行为
 *
 * 任意文件节点的 rwx 权限位判断，与 Linux 使用相同语义
 * !! Deskvue 在浏览器中运行，同一个会话只有单用户登录，因此不考虑用户组权限位
 *
 * !! 操作权限由 文件节点的 rwx 权限位 + owner 决定
 * 权限判定流程：
 *  0   获取当前的 用户标识
 *      !! 在 内核启动 | 根组件加载 | 用户登录之前，当前用户标识一定是 root
 *      !! 当 program 程序启动时，在 program 程序内部(模拟的进程内部)获取用户标识，按以下规则：
 *          根据当前程序 programInode._inode_.owner 返回用户标识：
 *              owner === root
 *                  返回 root
 *              owner === user | 当前用户的 iso:uuid
 *                  返回当前登录用户的 iso:uuid
 *              owner === 其他用户的 iso:uuid
 *                  !! 通常不可能，其他用户的 program 当前用户没有 x 执行权限，不会启动
 *  1   将获取到的用户标识 与 目标文件节点的 _inode_.owner 做比对：
 *      !! 用户标识是 root 时，使用 super 特权，跳过所有权鉴
 *      用户标识是 已登录的当前用户 iso:uuid 时：
 *          _inode_.owner === 当前用户的 iso:uuid
 *              这是用户自己的文件，拥有所有权限，按 _inode_.auth = 111 执行
 *          _inode_.owner === 'user'
 *              这是公共的用户文件，根据实际的 _inode_.auth 决定权限
 *          _inode_.owner === 其他用户的 iso:uuid
 *              这是别人的文件，当前用户只有 r 读权限，按 _inode_.auth = 100 执行
 *          _inode_.owner === 'root'
 *              这是系统文件，用户无任何权限，按 _inode_.auth = 0 执行
 *      !! 如果当前的已登录用户本身拥有 super 权限(由后端 Spf 的权鉴系统识别，属于业务端的 super)
 *          正常返回 iso:uuid 用户标识
 *          !! 但是会 setBzSuper(true) 标记 _BZ_SUPER_
 *          !! 能够执行 runAsRoot 临时提权
 *          !!  因为 业务端的 super 用户 通常是系统管理员，可能需要执行一些越权操作，例如：
 *                  临时修改 /sys/config 系统设置
 *                  访问 /mnt/db_*** 临时修改某些数据库参数 等
 */

import { dvTriggerKernelError } from '../../error'
import type { DvFsMemStruct, DvFsInodeAuth, DvFsCallContext, DvFsCaller } from '../types'
import { useDvFsCallCtx } from './useDvFsCallCtx'
import { useDvMemStore } from '../stores'
import { dvIs, dvExtend, dvCopy, dvLoget, dvTrimAny } from '@utils/core'

//权限位判断函数
export type DvFsAcFn = (a: DvFsInodeAuth) => boolean
//各 inode 节点句柄类 可以定义自己的 权限判断方法，在实例化此 hook 时传入 setter 方法
export type DvFsInodeAcFnSetter = (
    r: DvFsAcFn,
    w: DvFsAcFn,
    x: DvFsAcFn,
) => Record<string, DvFsAcFn>

//全局共享的 BZ_SUPER 标记
//!! 用户登录后，如果是 super 用户，需要设置此标记
let _BZ_SUPER_ = false
//!! 业务 super 用户临时提权 标记
let _AS_ROOT_ = false

export const useDvFsAc = (fnSetter?: DvFsInodeAcFnSetter) => {
    //定义 rwx 各权限位的判断函数
    //!! type DvFsInodeAuth = 0 | 1 | 10 | 11 | 100 | 101 | 110 | 111
    const r: DvFsAcFn = (a: DvFsInodeAuth) => a >= 100
    const w: DvFsAcFn = (a: DvFsInodeAuth) => Math.floor(a / 10) % 2 === 1
    const x: DvFsAcFn = (a: DvFsInodeAuth) => a % 2 === 1
    //通用的 权限位判断函数组
    const commonFns: Record<string, DvFsAcFn> = {
        r,
        w,
        x,
        rw: (a: DvFsInodeAuth) => r(a) && w(a),
        rx: (a: DvFsInodeAuth) => r(a) && x(a),
        wx: (a: DvFsInodeAuth) => w(a) && x(a),
        rwx: (a: DvFsInodeAuth) => r(a) && w(a) && x(a),
    }

    //构造权鉴函数 注册表
    //!! 不同的 文件节点类型句柄类，可以通过传入 fnSetter 构造自己特定的 权鉴函数组
    const acfns: Record<string, DvFsAcFn> =
        typeof fnSetter === 'function' ? dvExtend(commonFns, fnSetter(r, w, x)) : { ...commonFns }

    //构造标准的 op-key 用于在 acfns 权鉴方法注册表中查找
    const opKey = (inode: DvFsMemStruct, op: string): string => {
        //直接传入 rwx 权限字符，直接使用
        if ('r,w,x,rw,rx,wx,rwx'.split(',').includes(op.toLowerCase())) return op

        //构造 mode:[type:]op 结构的 op-key
        const mode = inode._inode_.mode
        const type = inode._inode_.extra?.type
        const opks: string[] = [mode]
        if (type && dvIs.nemstr(type)) opks.push(type)
        //op
        opks.push(op)
        return opks.join(':')
    }

    //标记 业务 super 用户
    const setBzSuper = (flag: boolean): void => {
        _BZ_SUPER_ = flag
    }
    //!! 业务 super 用户可能需要执行一些越权操作，需要临时提权
    const runAsRoot = (callback: any): any => {
        if (!_BZ_SUPER_) return
        //判断 callback 的类型
        const isfn = dvIs(callback, 'function')
        if (!isfn) return
        const resume = _AS_ROOT_
        //提权
        _AS_ROOT_ = true
        try {
            //执行操作
            return callback()
        } catch (e: any) {
            //全局错误处理，包含内核错误 panic 和 用户态的错误弹窗
            dvTriggerError(e)
        } finally {
            //恢复
            _AS_ROOT_ = resume
        }
    }

    //!! Ac 权鉴是否可用，根据 内核启动状态 stage 判断
    const acAvailable = (): boolean => {
        const stage = globalThis.DvKernel?.stage
        if (!stage) return false
        //fs-ready 文件系统就绪后
        if (stage.stageAfter('fs-ready', true)) return true
        //!! DvOs mount 在 fs-ready 之前，此时需要调用 /sys/prog0 程序创建基础 fs 目录结构
        //!! 因此需要额外开启权限通道
        if (stage.stageBefore('fs-ready') && stage.stageIs('os-mounting')) return true
        return false
    }

    //外部调用 ac(inode, 'lookup') == boolean
    const ac = (
        inode: DvFsMemStruct,
        op: string,
        //此次权鉴的调用上下文，内核启动时可以不传，用户态必须传入
        callCtx?: DvFsCallContext,
    ): boolean => {
        //!! 入口控制
        if (acAvailable() !== true) return false

        const ctxu = useDvFsCallCtx()
        //调用者
        let caller: string
        //调用 program
        let program: string

        //!! 业务 super 用户 临时提权标记
        if (_BZ_SUPER_ && _AS_ROOT_) {
            //!! caller 改为 root
            caller = 'root'
        }

        //无提权标记，则检查传入的 callCtx 调用上下文
        else {
            //未传入 callCtx
            if (!callCtx || !ctxu.isCallCtx(callCtx)) {
                //!! 在 用户还未登录的阶段 默认使用 root 用户作为 caller
                const gdk = globalThis.DvKernel
                if (!gdk || !gdk.stage) {
                    //!! 内核错误
                    dvTriggerKernelError('发生内核错误，内核对象不存在', 'PANIC')
                }

                //!! 用户已登录时，必须传入 caller 否则返回 false
                if (gdk.stage.stageAfter('is-login', true)) return false
                //!! 使用 root 用户作为 caller 默认跳过跳过权鉴
                return true
            }
            //传入了 callCtx
            else {
                caller = callCtx.caller
            }
        }

        //!! 传入 root 作为 caller 默认跳过跳过权鉴
        if (caller === 'root') return true

        //普通用户权鉴
        //检查 owner
        const owner = inode._inode_.owner
        //owner === root 普通用户无任何权限
        if (owner === 'root') return false
        //owner === caller 用户访问自己的文件节点，拥有所有权限
        if (owner === caller) return true

        //操作标识
        const opk = opKey(inode, op)
        const acf = acfns?.[opk]
        if (!acf) return false

        //文件现有 auth
        let auth: DvFsInodeAuth
        //默认 owner === user 用户公共文件，检查文件自身 auth
        if (owner === 'user' || owner === undefined) {
            auth = inode._inode_.auth
        }
        //owner === 其他用户 iso:uuid 用户只能 r 读 别人的文件
        else {
            auth = 100
        }

        return acf(auth)
    }

    return {
        r,
        w,
        x,
        setBzSuper,
        runAsRoot,
        acAvailable,
        ac,
    }
}

//工具类型
export type DvFsAcHook = ReturnType<typeof useDvFsAc>
