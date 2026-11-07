/**
 * Deskvue kernel
 * 基于 pinia 模拟 OS 中的 memory 内存的行为
 *
 * !! 仅通过 接口 向外部提供 内存操作方法，不涉及权鉴，无任何副作用
 * !! 所有权鉴操作，副作用（例如：节点的 open[] 引用列表，lock 锁，_icache_ 节点缓存）都
 * !! 应由节点对应的 文件句柄类实现并执行
 *
 * 例如：
 * 用户通过 /program/DvWebWord 程序执行 sysCall('fs:open', '/user/share/报告.docx')
 *      这个文件对应的句柄类是 DvMimeRegInode，需要通过 useDvInodeHandler 工厂方法进行句柄实例化：
 *          优先解析文件 ipath 获取节点数据（直接通过 内存接口，无需权鉴）
 *              查找节点数据中的 inode._icache_.handler 句柄实例缓存是否存在，存在则直接返回
 *                  不存在则读取 mode+type, 定位句柄类名，实例化句柄类
 *                      将得到的句柄实例缓存到文件节点的 _icache_.handler 中
 *          得到了句柄实例，就需要通过句柄方法执行权鉴：
 *              需要检查 /user/share 父目录的 x 权限，打开目录下文件需要目录本身的 x 权限，
 *                  handler.parentHandler().ac('dir:execute')
 *                  解析得到父目录这个操作也是直接调用 内存接口，无需权限
 *              再检查文件本身的 r 权限，打开某个普通 mime 文件需要 读 权限
 *                  handler.ac('reg:read')
 *              还要检查当前文件的 lock 锁状态，
 *              处理 open[] 引用列表
 *              ... 更多操作
 */

import {
    ref,
    reactive,
    readonly,
    computed,
    type ComponentPublicInstance,
    shallowReactive,
} from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import { dvTriggerKernelError, type DvKernelErrorLevel } from '../../error'
import type {
    DvFsInodeMode,
    DvFsInodeType,
    DvFsInodeAuth,
    DvFsCaller,
    DvFsMemStruct,
    DvFsInodeCreateOptions,
    DvFsInodeMemStruct,
    DvFsProgramMeta,
    DvFsProgramRegInodeExtra,
    DvFsPidCache,
    DvFsPidItem,
    DvFsProgramRegInodeIcache,
} from '../types'
import { dvFsFidKeywords } from '../types'
import { useDvFsIpath, useDvFsPid } from '../utils'
import { dvIs, dvWait, dvExtend, dvCopy, dvLoget, dvTrimAny } from '@utils/core'
import { md5 } from 'js-md5'

//utils
const ipu = useDvFsIpath()

export const useDvMemStore = defineStore(
    'dvMem',
    () => {
        //模拟 Linux 文件系统的 内存文件树
        //fs 本身就是一个 DvFsMemStruct 表示 / 全局根目录 base
        const fs = reactive<DvFsMemStruct>({
            _ipath_: '/',
            _inode_: {
                mode: 'dir',
                auth: 101,
                owner: 'root',
                time: { a: 0, c: 0, m: 0, d: 0 },
                name: '',
                modi: 0,
                lock: 0,
                open: [],
            },
            _icache_: {
                //缓存 根目录的 句柄实例，FS 初始化时会自动生成
                handler: null,
            },

            //!! /sys 系统根目录
            sys: {
                _ipath_: '/sys',
                _inode_: {
                    mode: 'dir',
                    auth: 101,
                    owner: 'root',
                    time: { a: 0, c: 0, m: 0, d: 0 },
                    name: '',
                    modi: 0,
                    lock: 0,
                    open: [],
                },
                _icache_: {
                    //缓存 /sys 句柄实例，FS 初始化时会自动生成
                    handler: null,
                },

                //!! /sys/prog0 根程序(0 号进程)
                prog0: {
                    _ipath_: '/sys/prog0',
                    _inode_: {
                        mode: 'reg',
                        auth: 101,
                        owner: 'root',
                        time: { a: 0, c: 0, m: 0, d: 0 },
                        name: '',
                        modi: 0,
                        lock: 0,
                        open: [],
                        extra: {
                            type: 'program',
                            component: 'DvOs',
                        },
                    },
                    _icache_: {
                        //缓存 /sys 句柄实例，FS 初始化时会自动生成
                        handler: null,
                    },
                },
            },
        })
        //外部暴露只读 fs 树
        const _fs = readonly(fs)
        //_inode_.name 缓存
        //!! fs 初始化时会根据现有的目录结构，构造这个缓存
        //!! 运行时 新建|删除|改名 等操作的同时，需要更新此缓存
        //!! 同一目录下 [fid] 和 显示名称 都不允许重名
        //!! 不同目录下，可以有相同显示名称的 子节点
        const inodeNameCache = reactive<Record<string, string[]>>({
            //!! 仅记录 [fid] !== _inode_.name 的节点 ipath
            //'_inode_.name': ['/foo/bar', '/foo/bar/jaz', 一定是不同目录下的节点],
        })
        //pid 缓存，建立 pid -> programNode._ipath_ 映射
        //!! 在程序 启动 和 停止 时，需要更新此缓存
        const pidCache = reactive<Record<string, string>>({
            //'prog_[program_name]_md5({props})': '/program/FooBar',
        })

        //内存接口，实际操作内存 store ，无权鉴
        //!! 权鉴由 文件句柄类 Dv***Inode 内部执行

        //判断是否有效的 inode 节点数据
        const isInode = (inode: any): boolean => {
            return inode !== undefined && dvIs.nemobj(inode) && inode._ipath_ && inode._inode_
        }
        //判断是否有效的 program 节点数据
        const isProgramInode = (inode: any): boolean => {
            if (!inode || !isInode(inode)) return false
            const node = inode as DvFsMemStruct
            const mode = node._inode_.mode
            const type = node._inode_.extra?.type
            return mode === 'reg' && type === 'program'
        }
        //判断 inode 节点的 显示名称
        //!! 基于 inodeNameCache 缓存做判断
        const inodeNameIs = (inode: DvFsMemStruct, name: string): boolean => {
            if (inodeNameCache?.[name] === undefined) return false
            const inc = inodeNameCache[name]
            return inc.includes(inode._ipath_)
        }
        //判断某个 inode 节点内，已存在有同名 _inode_.name 的子节点
        //!! 不递归，仅查找直接子节点
        //!! 存在则返回对应子节点的 fid，不存在则返回 false
        const nameExistsInInode = (inode: DvFsMemStruct, name: string): string | false => {
            if (inodeNameCache?.[name] === undefined) return false
            const inc = inodeNameCache[name]
            const ip = inode._ipath_
            //筛选出直接子节点
            const ips = inc.filter((i: string) => {
                if (!i.startsWith(ip)) return false
                const fid = i.slice(ip.length + 1)
                return !fid.includes('/')
            })
            if (ips.length <= 0 || !ips[0]) return false
            //找到的直接子节点的 ipath
            const ipi = ips[0]
            //截取 fid
            return ipi.slice(ip.length + 1)
        }
        //在指定的 inode 节点内，创建子节点时，重名检查
        //!! 传入的 name 一定是 fid，但是不能和 inode 内所有直接子节点的 显示名称 重名
        //!! 存在重名 返回 true 不存在则返回 false
        const checkFidExistsWhenCreateInInode = (inode: DvFsMemStruct, fid: string): boolean => {
            //inode 节点内存在同名 fid
            if (ipu.hasFid(inode, fid)) return true
            //将 fid 作为 显示名称，在 inode 内部检查
            if (nameExistsInInode(inode, fid) !== false) return true
            return false
        }
        //判断一个 ipath 文件节点是否已经存在
        const exists = (ipath: string): boolean => {
            return addr(ipath) !== undefined
        }
        //判断 inode 节点内部是否包含传入的子节点
        //!! 不递归
        const existsInInode = (inode: DvFsMemStruct, name: string): boolean => {
            return addrInInode(inode, name) !== undefined
        }

        //内存寻址，返回 文件节点数据(响应式)
        //!! ipath 参数可以是以下形式：
        //      真实的文件节点 全局唯一路径字符串，inode._ipath_
        //      使用 文件显示名称 或 名称.后缀 作为路径中的 文件名，需要查找 inodeNameCache[]
        //!!    直接传入不带 / 的字符串，默认作为 program| service 名称进行查找
        //!!        找不到则在字符串首位补 / 作为根目录查找
        const addr = (ipath: string): DvFsMemStruct | undefined => {
            if (!dvIs.nemstr(ipath) || ipath.trim() === '') return undefined

            //不带 / 的字符串
            if (ipath.trim().includes('/') !== true) {
                //作为 program | service 名称，查找
                const node = addrInProgram(ipath.trim())
                if (node) return node
            }

            //标准化 ipath
            ipath = ipu.norm(ipath)

            //访问 base 全局根目录 /
            if (ipu.isBase(ipath)) return fs as DvFsMemStruct

            //访问 root 根节点 /***
            //!! 根节点只能通过 fid 访问，因为系统目录 inode 信息不可修改
            if (ipu.isRoot(ipath)) {
                const rid = ipu.last(ipath)
                if (ipu.hasFid(fs as DvFsMemStruct, rid)) return fs[rid]
                return undefined
            }

            //子节点，先直接查找一次
            const node = dvLoget(fs, dvTrimAny(ipath, '/'), undefined)
            if (isInode(node)) return node

            //通过父节点，查找子节点
            //父目录
            const ppath = ipu.parent(ipath)
            //要查找的子文件节点名称，可能是 fid 或 显示名称
            const name = ipu.last(ipath)
            const pnode = addr(ppath)
            //必须满足条件
            if (!name || !dvIs.nemstr(name) || !pnode) return undefined

            //在父目录下查找
            return addrInInode(pnode, name)
        }
        //内存寻址，在指定的 inode 节点下，查找指定 name 的文件节点
        //!! 传入的可能是 显示名称 或 [fid]，可能包含 .** 后缀名
        const addrInInode = (inode: DvFsMemStruct, name: string): DvFsMemStruct | undefined => {
            //父节点必须存在
            if (!isInode(inode)) return undefined

            //如果传入的 name 是有效的 fid 则直接寻址
            if (ipu.isFid(name) && ipu.hasFid(inode, name)) {
                return inode[name]
            }

            //处理名称后缀
            const { ext, extn, rname } = ipu.parseExt(name)

            //优先将 rname 作为 fid
            if (ipu.isFid(rname)) {
                const node = inode?.[rname]
                if (isInode(node)) {
                    //如果存在 extn 后缀名，需要匹配
                    if (!ext || !extn || !dvIs.nemstr(extn) || ipu.extIs(node, extn)) return node
                }
            }

            //然后作为 name
            //!! 基于 inodeNameCache 缓存，查找 ipath
            if (inodeNameCache?.[rname] !== undefined) {
                const ifid = nameExistsInInode(inode, rname)
                if (!ifid || !inode[ifid]) return undefined
                const node = inode[ifid]
                if (isInode(node)) {
                    //如果存在 extn 后缀名，需要匹配
                    if (!ext || !extn || !dvIs.nemstr(extn) || ipu.extIs(node, extn)) return node
                }
            }

            //兜底
            return undefined
        }
        //内存寻址，专门通过 fid 或 显示名称，查找 program | service
        //!! 只能传入不带 / 的字符串，可能是：[fid|显示名][.后缀名]
        const addrInProgram = (name: string): DvFsMemStruct | undefined => {
            if (!dvIs.nemstr(name) || name.includes('/')) return undefined
            //去除可能存在的后缀名
            //!! program 文件节点不需要后缀名
            const { rname } = ipu.parseExt(name)

            //优先作为 fid 查找
            //先查找 program 目录
            let node = dvLoget(fs.program ?? {}, rname, undefined)
            if (isInode(node)) return node
            //然后查找 service 目录
            node = dvLoget(fs.sys.service ?? {}, rname, undefined)
            if (isInode(node)) return node

            //未找到，则作为显示名称
            //先查找 program 目录
            let fid = nameExistsInInode(fs.program ?? {}, rname)
            if (fid !== false) {
                node = dvLoget(fs.program ?? {}, fid, undefined)
                if (isInode(node)) return node
            }
            //未找到，再查找 service 目录
            fid = nameExistsInInode(fs.sys.service ?? {}, rname)
            if (fid !== false) {
                node = dvLoget(fs.sys.service ?? {}, fid, undefined)
                if (isInode(node)) return node
            }

            //未找到
            return undefined
        }
        //内存寻址，快速返回当前的 session 会话数据，只有用户登录成功后才能获取到
        const addrSession = (): DvFsMemStruct | undefined => {
            const stage = globalThis.DvKernel.stage
            if (!stage || stage.stageBefore('is-login')) return undefined
            return addr('/sys/session')
        }
        //获取指定 inode 节点下的有效的子节点，返回 fid[]
        const inodeChildFids = (inode: DvFsMemStruct): string[] => {
            return Object.keys(inode).filter((i: string) => ipu.isFid(i))
        }
        //判断某个 inode 节点是否包含有效的子节点
        const inodeHasChild = (inode: DvFsMemStruct): boolean => {
            const fids = inodeChildFids(inode)
            return fids.length > 0
        }
        //创建文件节点，创建成功则返回 新文件节点的 ipath
        //!! 仅操作内存数据，不权鉴，没有副作用，所有额外操作，由 文件句柄类实现
        const create = async (
            ipath: string,
            opts?: DvFsInodeCreateOptions,
            recursive?: boolean,
        ): Promise<string | undefined> => {
            if (exists(ipath)) return realIpath(ipath)
            //父目录
            const ppath0: string = ipu.parent(ipath)
            let ppath: string | undefined = ppath0
            //console.log(ppath)

            //如果父目录不存在
            if (!exists(ppath0)) {
                //指定递归
                if (recursive === true) {
                    ppath = await create(
                        ppath0,
                        {
                            mode: 'dir',
                            inode: {
                                auth: 111,
                            },
                        },
                        true,
                    )
                } else {
                    return undefined
                }
            }
            //父目录未能创建，返回
            if (!ppath) return undefined

            //读取父节点
            const pnode = addr(ppath)
            if (!pnode) return undefined

            //子节点名称
            let fname = ipu.last(ipath)
            return await createInInode(pnode, fname, opts)
        }
        //在指定的 inode 节点下，创建指定 name 的子节点，创建成功则返回 新文件节点的 ipath
        const createInInode = async (
            inode: DvFsMemStruct,
            name: string,
            opts?: DvFsInodeCreateOptions,
        ): Promise<string | undefined> => {
            //父目录必须存在
            if (!isInode(inode)) return undefined
            //!! create 手动创建子节点，传入的 name 必须符合 isFid 要求
            if (!ipu.isFid(name)) return undefined

            //新节点的默认参数
            //根据 创建的是否是 /*** 根目录，有所区别
            const now = Date.now()
            const isbase = ipu.isBase(inode._ipath_)
            let dft: DvFsInodeMemStruct = {
                mode: opts?.mode ?? 'reg',
                //根据是否是 根目录节点，节点参数有所区别
                auth: isbase ? 101 : (opts?.auth ?? 111),
                owner: isbase ? 'root' : (opts?.owner ?? 'user'),
                time: isbase ? { a: 0, c: 0, m: 0, d: 0 } : { a: now, c: now, m: now, d: 0 },
                name,
                //!! 脏标记，只针对普通节点，根目录节点不标记，因为根目录节点不会被持久化
                modi: isbase ? 0 : 1,
                lock: 0,
                open: [],
                extra: {
                    type: opts?.type ?? '',
                },
            }
            //与传入的 opts.inode 合并
            const ninode = dvExtend<DvFsInodeMemStruct>(dft, opts?.inode ?? {})

            //处理 .** 后缀名
            const { ext, extn, rname } = ipu.parseExt(name)

            //没有后缀名，或 手动指定了文件 type 则忽略 后缀名
            if (!ext || (opts?.type && opts.type !== 'ext')) {
                //!! 重名检查
                if (checkFidExistsWhenCreateInInode(inode, name)) {
                    //!! 重名需要提示用户
                    return dvTriggerError(
                        new Error(`无法创建新文件，${inode._ipath_} 路径下已存在文件名 ${name}`),
                        false,
                        undefined,
                    )
                }
                //写入
                const nip = ipu.join(inode._ipath_, name)
                inode[name] = {
                    _ipath_: nip,
                    _inode_: ninode,
                    _icache_: {},
                }
                await dvWait(50)
                return nip
            }

            //存在后缀名，或指定了 opts.type = 'ext'
            //!! 重名检查
            if (checkFidExistsWhenCreateInInode(inode, rname)) {
                //!! 重名需要提示用户
                return dvTriggerError(
                    new Error(`无法创建新文件，${inode._ipath_} 路径下已存在文件名 ${rname}`),
                    false,
                    undefined,
                )
            }
            //修改 ninode
            ninode.name = rname
            ninode.extra = {
                type: 'ext',
                mime: extn,
            }
            //写入
            const nip = ipu.join(inode._ipath_, rname)
            inode[rname] = {
                _ipath_: nip,
                _inode_: ninode,
                _icache_: {},
            }
            await dvWait(50)
            return nip
        }
        //维护 _inode_.name 名称缓存（仅记录 显示名称 !== fid 的节点 ipath）
        const _addNameCache = (name: string, ipath: string): void => {
            if (!dvIs.nemstr(name)) return
            //仅记录 显示名称与 fid 不一致的节点
            if (ipu.last(ipath) === name) return
            if (inodeNameCache[name] === undefined) inodeNameCache[name] = []
            if (!inodeNameCache[name].includes(ipath)) inodeNameCache[name].push(ipath)
        }
        const _delNameCache = (name: string, ipath: string): void => {
            if (!dvIs.nemstr(name)) return
            const arr = inodeNameCache[name]
            if (arr === undefined) return
            const idx = arr.indexOf(ipath)
            if (idx > -1) arr.splice(idx, 1)
            if (arr.length === 0) delete inodeNameCache[name]
        }
        //rename 改名时，同一目录下重名检查（排除自身）
        //!! 新显示名称不能与同一目录下 其他子节点的 fid 或 显示名称 重名
        const _nameConflict = (
            parent: DvFsMemStruct,
            selfIpPath: string,
            name: string,
        ): boolean => {
            //作为 fid 检查
            if (ipu.hasFid(parent, name)) {
                const n = parent[name] as DvFsMemStruct | undefined
                if (n && n._ipath_ !== selfIpPath) return true
            }
            //作为显示名称检查
            const fid = nameExistsInInode(parent, name)
            if (fid !== false) {
                const n = parent[fid] as DvFsMemStruct | undefined
                if (n && n._ipath_ !== selfIpPath) return true
            }
            return false
        }
        //重命名节点：修改 _inode_.name 显示名称
        const rename = async (ipath: string, name: string): Promise<boolean> => {
            //节点必须存在
            const node = addr(ipath)
            if (!node || !isInode(node)) return false
            //新显示名称
            if (!dvIs.nemstr(name)) return false
            //父目录
            const parent = addr(ipu.parent(node._ipath_))
            if (!parent || !isInode(parent)) return false
            //重名检查
            if (_nameConflict(parent, node._ipath_, name)) return false
            //维护名称缓存：移除旧名称
            _delNameCache(node._inode_.name, node._ipath_)
            //写入新显示名称
            node._inode_.name = name
            //!! 这些操作在 句柄类中执行
            //node._inode_.modi = 1
            //node._inode_.time.c = Date.now()
            //维护名称缓存：添加新名称
            _addNameCache(name, node._ipath_)
            await dvWait(50)
            return true
        }
        //删除节点
        const unlink = async (ipath: string, opts?: PlainObject): Promise<boolean> => {
            //节点必须存在
            const node = addr(ipath)
            if (!node || !isInode(node)) return false
            //!! 不允许删除 全局根目录 / 或 根目录 /***
            if (ipu.isBase(node._ipath_) || ipu.isRoot(node._ipath_)) return false
            //父目录
            const parent = addr(ipu.parent(node._ipath_))
            if (!parent || !isInode(parent)) return false
            //维护名称缓存
            _delNameCache(node._inode_.name, node._ipath_)
            //从父目录对象上移除子节点
            delete parent[ipu.last(node._ipath_)]
            await dvWait(50)
            return true
        }
        //在指定的 inode 节点内，删除指定 name 的子节点
        const unlinkInInode = async (
            inode: DvFsMemStruct,
            name: string,
            opts?: PlainObject,
        ): Promise<boolean> => {
            if (!isInode(inode)) return false
            //解析子节点（name 可能是 fid 或 显示名称）
            const child = addrInInode(inode, name)
            if (!child || !isInode(child)) return false
            //!! 不允许删除 根目录 /***
            if (ipu.isRoot(child._ipath_)) return false
            //维护名称缓存
            _delNameCache(child._inode_.name, child._ipath_)
            //从父目录对象上移除子节点
            delete inode[ipu.last(child._ipath_)]
            await dvWait(50)
            return true
        }
        //移动节点，返回新节点 ipath
        //!! 无权鉴，句柄类必须先执行权鉴，才能调用此接口
        const mv = async (from: string, to: string): Promise<string | undefined> => {
            const oNode = addr(from)
            let nNode = addr(to)
            //from 节点必须存在，to 节点不能存在
            if (!oNode || !isInode(oNode) || (nNode && isInode(nNode))) return undefined
            //原 ipath
            const oip = oNode._ipath_
            //不能是 / 或 /***
            if (ipu.isBase(oip) || ipu.isRoot(oip)) return undefined
            //创建新节点，获取新 ipath
            const nip = await create(to)
            if (!nip) return undefined
            //获取新创建的 节点 inode
            nNode = addr(nip)
            if (!nNode) return undefined
            //修改新节点数据
            const oInode = dvCopy(oNode._inode_) as PlainObject
            //运行时标记都删除
            delete oInode.modi
            delete oInode.lock
            delete oInode.open
            delete oInode.time
            //name 使用新的
            oInode.name = ipu.last(nip)
            //写入新节点
            nNode._inode_ = dvExtend<DvFsInodeMemStruct>(false, nNode._inode_, oInode)

            //处理子节点
            if (inodeHasChild(oNode)) {
                const fids = inodeChildFids(oNode)
                //依次将子节点写入 新节点
                //!! 无权鉴，外部句柄类必须权鉴通过
                for (let i = 0; i < fids.length; i++) {
                    const fid = fids[i]
                    if (!fid) continue
                    const sino = oNode[fid]
                    if (!sino) continue
                    await _mvChildInode(sino as DvFsMemStruct, nNode)
                }
            }

            //删除原节点
            const delok = await unlink(oip)
            //!! 删除失败，需要回滚
            if (!delok) {
                //删除新建的节点
                await unlink(nip)
                return undefined
            }

            //返回新建节点的 ipath
            return nip
        }
        //递归方法，将传入的 inode 节点，写入目标节点下级
        //!! 如果 inode 包含子节点，则递归
        //!! 需要处理 节点 ipath 以及 inodeNameCache
        const _mvChildInode = async (inode: DvFsMemStruct, to: DvFsMemStruct): Promise<void> => {
            const toip = to._ipath_
            const fid = ipu.last(inode._ipath_)
            const ipath = ipu.join(toip, fid)
            const copy = {
                _ipath_: ipath,
                _inode_: dvExtend(false, inode._inode_, {
                    modi: 0,
                    lock: 0,
                    open: [],
                    time: { c: Date.now() },
                }),
                _icache_: dvExtend(false, inode._icache_ ?? {}, {
                    handler: null,
                }),
            }
            //写入
            to[fid] = copy as DvFsMemStruct

            //处理 inodeNameCache
            if (inodeNameIs(inode, inode._inode_.name)) {
                const ins = inodeNameCache[inode._inode_.name]
                if (ins && ins.indexOf(inode._ipath_) >= 0) {
                    ins.splice(ins.indexOf(inode._ipath_), 1, ipath)
                }
            }

            //递归子节点
            if (inodeHasChild(inode)) {
                const fids = inodeChildFids(inode)
                for (let i = 0; i < fids.length; i++) {
                    const sfid = fids[i]
                    if (!sfid) continue
                    const sino = inode[sfid]
                    if (!sino) continue
                    await _mvChildInode(sino as DvFsMemStruct, to[fid])
                }
            }
        }

        //文件节点路径参数聚合
        //将传入的 文件路径 转为标准的 _ipath_
        const realIpath = (ipath: string): string | undefined => {
            //文件节点
            const inode = addr(ipath)
            if (!inode || !inode._ipath_) return undefined
            return inode._ipath_
        }
        //根据传入的 文件路径，返回文件节点标准类型数据
        const inodeType = (
            ipath: string,
        ):
            | {
                  ipath: string
                  imode: DvFsInodeMode
                  itype?: DvFsInodeType
              }
            | undefined => {
            //文件节点
            const inode = addr(ipath)
            if (!inode || !isInode(inode)) return undefined
            const rtn = {
                ipath: inode._ipath_,
                imode: inode._inode_.mode ?? 'reg',
            } as {
                ipath: string
                imode: DvFsInodeMode
                itype?: DvFsInodeType
            }
            if (inode._inode_.extra?.type) {
                rtn.itype = inode._inode_.extra.type
            }
            return rtn
        }
        //根据传入的 program ipath ，获取对应 Vue 组件的 options 定义
        const programMeta = (ipath: string): DvFsProgramMeta | undefined => {
            const inode = addr(ipath)
            if (!inode || !isProgramInode(inode)) return undefined
            const extra = inode._inode_.extra as DvFsProgramRegInodeExtra
            const comp = extra?.component
            if (!comp) return undefined
            //!! DvOs 根组件跳过
            //if (comp === 'DvOs') return {} as DvFsProgramMeta
            //读取全局组件的 定义
            const define = globalThis.DvApp?.component(comp)
            if (!define) return undefined

            // 异步组件（defineAsyncComponent）→ 解包出真实组件
            let def: any = define
            if (typeof (define as any).__asyncLoader === 'function') {
                def = (define as any).__asyncResolved ?? (define as any).__asyncLoader
            }

            // 此时 def 才是真实组件，返回可能存在的 programMeta
            if (!def || !def.programMeta) return undefined
            return dvCopy<DvFsProgramMeta>(def.programMeta)
        }
        //根据传入的 program 文件路径，返回 program 类型数据
        const programType = (
            ipath: string,
        ):
            | {
                  ipath: string
                  itype: 'program' | 'service'
                  running: boolean
              }
            | undefined => {
            //文件节点
            const inode = addr(ipath)
            const meta = programMeta(ipath)
            if (!inode || !isProgramInode(inode) || !meta) return undefined
            return {
                ipath: inode._ipath_,
                itype: meta.isService ? 'service' : 'program',
                running:
                    inode._icache_ && inode._icache_.program && dvIs.nemobj(inode._icache_.program),
            } as {
                ipath: string
                itype: 'program' | 'service'
                running: boolean
            }
        }

        //program 程序运行时的内存结构
        //!! service 是特殊形式的 program 使用相同的存储结构

        //program 程序运行时内存空间 和 对应 Vue 组件实例
        //!! 键名是 pid ，程序运行时根据 props 生成的全局唯一的进程 id
        const program = reactive<Record<string, PlainObject>>({})
        const programInstance = shallowReactive<Record<string, ComponentPublicInstance>>({})
        //在 program 指向的组件内部，访问自有的内存空间
        const getProgramMem = <T extends PlainObject>(pid: string): T | undefined => {
            //按 pid 获取对应的内存数据，响应式
            return program?.[pid] as T
        }
        //占用内存空间
        const createProgramMem = async <T extends PlainObject>(
            pid: string,
            init?: Partial<T>,
        ): Promise<boolean> => {
            //!! 不能重复创建
            if (program?.[pid] !== undefined) {
                //!! 内核报错
                dvTriggerKernelError(`发生内核错误，程序 [PID=${pid}] 内存空间不能重复创建`)
                return false
            }
            //创建 program.pid
            //!! 默认写入 pid 到程序私有内存中
            program[pid] = dvExtend(init ?? {}, { pid }) as T
            //等待数据同步
            await dvWait(50)
            return true
        }
        //释放内存空间
        const releaseProgramMem = async (pid: string): Promise<boolean> => {
            //已释放
            if (!program?.[pid]) return true
            //释放
            delete program[pid]
            //等待数据同步
            await dvWait(50)
            return true
        }
        //复合方法，由 DvProgramRegInode 句柄实例 在 open|close 中调用，批量处理内存相关的处理
        //!! 无权鉴，句柄实例内部权鉴完成后，再调用此方法
        //!! 传入 T 为 vue 组件内部定义的当前组件内存数据的 类型结构
        const setMemOnProgramStart = async <T extends PlainObject>(
            ipath: string,
            props?: PlainObject,
            memInit?: Partial<T>,
        ): Promise<string | undefined> => {
            //程序启动时的 内存操作
            // 0 组装 pid
            const pidu = useDvFsPid()
            const pid = pidu.createPid(ipath, props)
            const meta = programMeta(ipath)
            if (!pid || !meta) {
                //!! 报 内核错误
                dvTriggerKernelError(`发生内核错误，${ipath} 不是一个可执行的程序节点`)
                return undefined
            }
            // 1 判断 pid 是否已存在
            if (program?.[pid] !== undefined || pidCache?.[pid] !== undefined) {
                //已存在，直接返回原有的 pid
                return pid
            }
            // 2 pid 不存在，开始执行 程序运行时内存初始化
            const memok = await createProgramMem<T>(pid, memInit)
            if (!memok) {
                //!! 报 内核错误
                dvTriggerKernelError(`发生内核错误，启动 ${meta?.title ?? ipath} 时无法初始化内存`)
                return undefined
            }
            // 3 修改 program 内存节点数据
            const inode = addr(ipath)
            //!! 能正确生成 pid 则不可能 !inode
            if (!inode) return undefined
            //!! 开始执行程序启动内存初始化，表示已经过句柄实例权鉴，_icache_ 一定已经创建(句柄工厂中创建)
            if (!inode._icache_) inode._icache_ = {} as DvFsProgramRegInodeIcache
            //meta 拷贝到 icache
            inode._icache_.meta = dvCopy(meta)
            //pid 的运行时节点数据
            if (!inode._icache_.program) inode._icache_.program = {}
            inode._icache_.program[pid] = {
                root: meta?.isService ? '/' : '/user',
                dir: meta?.isService ? '/' : '/user',
                opens: [],
                props,
                memInit,
            } as DvFsPidCache
            //等待状态同步
            await dvWait(50)
            //!! 等待状态同步后将 pid 写入缓存
            //pidItems|winItems 依赖 pidCache 来生成 进程|窗口 列表
            pidCache[pid] = inode._ipath_
            //返回生成的 pid
            return pid
        }
        //!! 此方法仅操作内存数据，无权鉴，无副作用，句柄实例在调用此方法之前，必须先清理 对应的 opens[] 中的节点引用
        const setMemOnProgramStop = async (pid: string): Promise<boolean> => {
            //根据 pid 获取节点数据
            const inode = getProgramInodeByPid(pid)
            if (!inode || !isProgramInode(inode)) return true
            const progs = inode._icache_.program
            //!! 优先释放 pidCache 缓存，这样 pidItems|winItems 列表会先删除组件实例
            if (pidCache?.[pid]) {
                delete pidCache[pid]
            }
            await dvWait(10)

            //释放程序内存空间
            await releaseProgramMem(pid)
            //再修改 program 节点数据
            if (progs && progs?.[pid]) {
                delete progs[pid]
            }
            //!! 如果没有其他运行中的此 program 程序的实例，则释放节点数据中的 _icache_
            //!! 暂不释放，_icache_.handler 中保存了句柄实例，下一次启动时不需要再次创建
            //if (inode._icache_ && !dvIs.nemobj(progs)) {
            //    delete inode._icache_
            //}
            //等待状态同步
            await dvWait(50)
            return true
        }
        //根据 pid 获取对应的 program 节点数据
        const getProgramInodeByPid = (pid: string): DvFsMemStruct | undefined => {
            if (pidCache?.[pid] === undefined) return undefined
            const inode = addr(pidCache[pid])
            if (!inode || !isProgramInode(inode)) return undefined
            return inode
        }
        //根据 program 节点 ipath 获取所有正在运行的 pid
        const getPidsByIpath = (ipath: string): string[] => {
            const inode = addr(ipath)
            if (!inode || !isProgramInode(inode)) return []
            return Object.keys(inode._icache_.program ?? {})
        }
        //在程序运行时修改 _icache_.meta 可能会影响程序组件的 props
        const setMetaOnProgramRunning = async (
            pid: string,
            meta: Partial<DvFsProgramMeta>,
        ): Promise<void> => {
            if (!pidCache?.[pid] || !program?.[pid]) return
            const ipath = pidCache[pid]
            const inode = addr(ipath)
            if (!inode || !isProgramInode(inode)) return
            if (!inode._icache_.meta) return
            inode._icache_.meta = dvExtend(false, inode._icache_.meta, meta ?? {})
        }

        //根据 program[] 自动输出用于渲染界面的 模拟进程列表
        //!! 任务管理器(/sys/service/DvTaskService) 根据此数组显示 进程列表
        //!! 窗口管理器(/sys/service/DvWinService) 根据此数组 动态挂载 Vue 组件实例
        const pidItems = computed<DvFsPidItem[]>(() => {
            const items: DvFsPidItem[] = []
            if (!dvIs.nemobj(program) || !dvIs.nemobj(pidCache)) return items
            for (const pid in pidCache) {
                const ipath = pidCache[pid]
                if (!ipath) continue
                //meta
                const meta = programMeta(ipath)
                //inode
                const inode = getProgramInodeByPid(pid)
                //icache
                const icache = inode?._icache_ as DvFsProgramRegInodeIcache
                //pidcache
                const pcache = icache.program?.[pid]
                if (!meta || !inode || !icache || !pcache) continue

                //输出
                items.push({
                    pid,
                    ipath,
                    name: meta.name,
                    meta,
                    props: pcache.props,
                })
            }
            return items
        })
        const winItems = computed<DvFsPidItem[]>(() => {
            const items = pidItems.value
            if (items.length <= 0) return []
            const wins: DvFsPidItem[] = []
            for (const item of items) {
                const meta = item.meta
                //!! 必须包含 gui.winProps 窗口参数
                if (!meta || !meta.gui || !meta.gui.winProps) continue
                wins.push(item)
            }
            return wins
        })

        return {
            fs: _fs,

            isInode,
            isProgramInode,
            inodeNameIs,
            nameExistsInInode,
            checkFidExistsWhenCreateInInode,

            addr,
            addrInInode,
            addrInProgram,
            addrSession,
            inodeChildFids,
            inodeHasChild,
            exists,
            existsInInode,
            create,
            createInInode,
            rename,
            unlink,
            unlinkInInode,
            mv,

            realIpath,
            inodeType,
            programType,
            programMeta,

            program,
            programInstance,
            getProgramMem,
            createProgramMem,
            releaseProgramMem,
            setMemOnProgramStart,
            setMemOnProgramStop,
            getProgramInodeByPid,
            getPidsByIpath,
            setMetaOnProgramRunning,

            pidItems,
            winItems,
        }
    },
    {
        persist: false,
    },
)

//返回 store 类型
export type DvMemStore = ReturnType<typeof useDvMemStore>
