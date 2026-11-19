/**
 * Deskvue kernel
 * 基于 pinia 模拟 Linux 系统中的 磁盘行为
 *
 * 内存文件树，持久化保存的行为：
 *  0   内存树中的文件节点数据结构 DvFsMemStruct 与 磁盘中的文件节点数据结构 DvFsHddStruct 的细微区别：
 *          两者都有的结构：{
 *              _ipath_: '/foo/bar/jaz',    节点绝对路径，全局唯一的寻址依据，一定以 / 开头
 *              _inode_: {                  节点元数据
 *                  mode: 'reg',            节点基础类型，reg,dir,lnk,chr,blk,sock
 *                  auth: 111,              节点 rwx 权限位
 *                  owner: 'user',          节点归属者，root | user | iso:uuid
 *                  name: '显示名称',        此节点的显示名称，仅显示，不参与寻址
 *                  time: {a,c,m,d},        节点时间戳，毫秒
 *                  extra?: {               节点额外参数
 *                      type?: 'program',   节点的扩展类型
 *                      mime?: '*.conf',    如果是 reg+ext 类型的节点，需要指定此节点的实际后缀名
 *                      !! 根据节点类型的不同，会有不同的数据结构保存在这里，例如：program 程序节点，这里需要保存 component
 *                  }
 *              },
 *          }
 *          内存节点数据特有结构 DvFsMemStruct：{
 *              _inode_: {
 *                  modi: 1,        节点脏标记，需要刷盘的标记为 1
 *                  lock: 0,        节点锁定标记，有程序打开此文件节点并持有的，标记为 1
 *                  open: [],       此节点被哪些其他节点打开并持有，记录这些其他节点的 ipath
 *              },
 *              _icache_: {         内存文件节点的运行时缓存
 *                  handler: null,  文件节点句柄实例缓存，所有已打开的节点共享句柄实例
 *                  content?: any,  某些类型文件节点的内容需要被缓存在这里
 *                                  !! 如果节点文件内容被修改，修改后的文件内容也保存在这里
 *                  !! 根据节点类型不同，会有不同的运行时缓存数据，例如：program 程序节点，这里要保存 meta{} | program{pid}
 *              }
 *          }
 *          磁盘节点数据特有结构 DvFsHddStruct：{
 *              !! 磁盘数据必须包含 _content_ 他是实际保存的文件节点的 内容载体
 *              !! 刷盘时，最终修改后文件数据会被填到这里
 *              _content_: {
 *                  !! 根据节点类型的不同，会有不同的 _content_ 结构，例如：
 *                  reg 普通文件，如果不指定扩展类型，则这里是 纯字符串内容
 *                  program 程序节点，这里是:
 *                      component: 'DvExplorer'
 *              }
 *          }
 *
 *  1   针对 dvMem.fs.sys|program|dev|mnt.. 这些系统目录下的文件节点，在磁盘中持久化方法：
 *
 *      1.0 分层存储，区分用户无关的全局数据，和用户自定义的数据
 *          需要分层存储的系统文件通常有：
 *              dvMem.fs.sys.config         系统设置，reg+ext 类型，*.conf 后缀名，分别存储在：
 *                  dvHdd.fs.sys.config
 *                  dvHdd.userFs.[iso:uuid].config
 *                      _content_ = { ... 系统设置内容 ... }
 *              dvMem.fs.mnt.db.foo         数据库配置 schema 数据，blk+db 类型
 *              dvMem.fs.mnt.db.foo.bar     数据模型配置 schema 数据，reg+model 类型，分别存储在：
 *                  dvHdd.fs.mnt.db.foo
 *                  dvHdd.fs.mnt.db.foo.bar
 *                  dvHdd.userFs.[iso:uuid].db.foo
 *                  dvHdd.userFs.[iso:uuid].db.foo.bar
 *                      _content_ = {
 *                          schema: { ... 数据库 schema ... },
 *                          expireAt: 过期时间戳，秒,
 *                          bar: { ... 数据模型的 schema ... }
 *                      }
 *
 *          !! 这些文件节点，在 FS 内存树构建时，需要分步创建内存节点：
 *              os-mounting 阶段：
 *                  内存树中创建 /*** 根目录，然后从 dvHdd 中读取对应的根目录中的数据，转换为内存节点数据并挂载
 *              user-initing 阶段：
 *                  从 dvHdd.userFs.[iso:uuid] 用户数据下读取对应的根目录中的数据，覆盖合并到对应内存节点数据中
 *
 *      1.1 只保存用户无关的文件数据
 *          这些文件通常有：
 *              dvMem.fs.sys.update             系统更新数据，reg+ext 类型，*.upd 后缀名，保存在：
 *                  dvHdd.fs.sys.update
 *                      _content_ = {
 *                          update: { ... 系统更新包数据 ... },
 *                          hash: 'md5(...)',
 *                          remote: { ... 远程配置数据，用户 功能启停、灰度发布测试 等 ... },
 *                          remoteHash: 'md5(...)',
 *                      }
 *              dvMem.fs.dev.usb.foo            全局启用的 WebUSB 已经连接过的设备，chr+usb 类型，保存在：
 *                  dvHdd.fs.dev.usb.foo
 *                      _content_ = {
 *                          type: 'web_printer',            设备类型，可用于路由到专门的操作类
 *                          filter: {                       用来匹配，就是传给 requestDevice 的 filter
 *                              vendorId?: number,
 *                              productId?: number,
 *                              classCode?: number,
 *                              subclassCode?: number,
 *                              protocolCode?: number,
 *                          },
 *                          serialNumber?: 'string',        精确匹配设备
 *                          createdAt: 记录创建时间,
 *                          lastConnected: 上次是否成功打开，UI 标记
 *                      }
 *              dvMem.fs.dev.driver.GlobalDriver    全局可用的定制驱动，chr+driver 类型，保存在：
 *                  dvHdd.fs.dev.driver.GlobalDriver
 *                      _content_ = {
 *                          driver: 'GlobalDriver',     可以通过 useDvDriver('GlobalDriver') 定位到具体类的 键名
 *                          ioctls: { ... 缓存 接口方法注册表 ... }
 *                      }
 *              dvMem.fs.mnt.idb.foo            全局启用的 IndexedDb 数据库，blk+idb 类型，保存在：
 *                  dvHdd.fs.mnt.idb.foo
 *                      _content_ = {
 *                          store: '连接到哪个库',
 *                          version: '版本号',
 *                          ...
 *                      }
 *              dvMem.fs.mnt.local.local_dir    全局可用的 File System Access API（本地文件），保存在：
 *                  dvHdd.fs.mnt.local.local_dir
 *                      _content_ = {
 *                          !! localStorage 无法序列化一个 本地文件夹的 handler 句柄实例
 *                          !! 此功能暂时无法实现
 *                      }
 *      1.2 保存用户相关的文件数据
 *          这些文件通常有：
 *              dvMem.fs.program.MyProgram      用户自行安装的 program 程序，reg+program 类型，保存在：
 *                  dvHdd.userFs.[iso:uuid].program.MyProgram
 *                      _content_ = {
 *                          component: 'MyProgram',     可以通过 useDvProgram('MyProgram') 定位到 Vue 组件定义
 *                          define?: { ... 缓存 vue 组件定义，包含 programMeta{} 数据 ... }
 *                      }
 *              dvMem.fs.dev.driver.MyDriver    与 1.1 结构一致，只是保存在用户空间，只能由当前用户调用
 *                  dvHdd.userFs.[iso:uuid].dev.driver.MyDriver
 *              dvMem.fs.mnt.idb.my_idb         与 1.1 结构一致，只是保存在用户空间，只能由当前用户调用
 *                  dvHdd.userFs.[iso:uuid].mnt.idb.my_idb
 *
 *      !! config 全局配置 与 update 系统更新流程：
 *          os-mounting 阶段：从 dvHdd.fs.sys.config|update 读取全局配置，转换为内存节点数据，挂载到对应目录
 *          service-ready 阶段：由 DvUpdateService 服务启动，会拉取一次后台的 系统更新 hash
 *              经过比对确认需要执行系统更新，拉取更新数据后，通过 FS write 流程：
 *                  写入 dvMem.fs.sys.config|update._icache_.content
 *                  打脏标记
 *                  在刷盘时写回 dvHdd
 *          user-initing 阶段：从 dvHdd.userFs.[iso:uuid].config 读取用户个性化配置，合并覆盖到：
 *              dvMem.fs.sys.config._icache_.content
 *              !! 不打脏标记，不会被写回 dvHdd.fs.sys.config
 *          ready 之后：用户通过 DvSettings 程序修改系统配置，会：
 *              直接修改 dvHdd.userFs.[iso:uuid].config._content_ 不经刷盘逻辑
 *              同时会将修改后的系统配置，合并覆盖到 dvMem.fs.sys.config._icache_.content
 *          系统运行过程中，任意程序内读取系统配置，直接读取 dvMem.fs.sys.config._icache_.content
 *
 *      !! /mnt/db 目录下的 数据库|数据模型 节点
 *          os-mounting 阶段：从 dvHdd.fs.mnt.db 路径下读取数据库节点，转换为内存节点数据，挂载到对应目录
 *          ready 之后：用户打开 DvDbManager 程序后，指向某个数据库，会先检查 schema 数据的过期状态
 *              确认需要重新拉取 schema 数据后，后台拉去数据，走 FS write 流程：
 *                  修改 dvMem.fs.mnt.db.foo._icache_.content
 *                  打脏标记
 *                  刷盘时写回 dvHdd.fs.mnt.db.foo
 *              不需要重新拉取，则读取 dvHdd.userFs.[iso:uuid].db.foo 数据，合并覆盖到：
 *                  dvMem.fs.mnt.db.foo._icache_.content
 *                  !! 不打脏标记，不会写回
 *              用户在 DvDbManager 程序内个性化配置数据库数据模型的 schema 则会：
 *                  直接写 dvHdd.userFs.[iso:uuid].db.foo._content_ 不经刷盘逻辑
 *          系统运行过程中，任意程序内读取数据库|数据模型 schema，直接读取 dvMem.fs.mnt.db.foo._icache_.content
 *
 *      !! /program | /sys/service 目录下的 program 程序节点：
 *          os-mounting 阶段：将 app.config.globalProperties.$programs 下的 全局|业务 程序|服务 挂载到对应目录下
 *          user-initing 阶段：读取 dvHdd.userFs.[iso:uuid].program 目录下的用户自行安装的程序，转换为内存节点数据，挂载到
 *          /program 目录下
 *          ready 之后：用户自行安装的程序，与内置程序使用相同的 启动|停止|多进程 机制
 *
 *      !! /dev 目录下的资源挂载流程：
 *          os-mounting 阶段：从 dvHdd.fs.dev 读取全局资源，转换为内存节点数据，挂载到对应目录
 *          user-initing 阶段：从 dvHdd.userFs.[iso:uuid].dev 读取用户自有资源，转换为内存节点数据，挂载到对应目录
 *          ready 之后：由 DvDeviceService 服务 弹窗提示用户重新连接设备，用户点击确认，重新获取资源句柄，操作各节点 icache：
 *              _icache_ = {
 *                  handler: null,      文件节点句柄实例
 *                  content: {
 *                      ... 磁盘中的 _content_ 数据
 *                  },
 *                  connected: true
 *              }
 *          之后在任意程序中：
 *              const webCam = await sysCall('dev:open', '/dev/usb/web_cam')
 *              webCam.anyApi(...)
 *              const driver = await sysCall('dev:open', '/dev/driver/MyDriver')
 *              driver.ioctl('api', ...args)
 *
 *
 *  2   dvMem.fs.user 用户文件夹
 *          保存在：dvHdd.userFs.[iso:uuid].user，目录结构完全一致，例如：
 *              dvHdd.userFs.[iso:uuid].user.share  -->  dvMem.fs.user.share
 *          文件内容的保存形式，见下方注释：“dvHdd 磁盘中 文件节点的 _content_ 保存数据结构”
 *          文件内容的读取方式使用默认的 addr 寻址方法：
 *              const cnt = dvHdd.addr('ipath')
 *              !! 会自动补齐 用户的 uSign (iso:uuid)
 *          文件内容的 读取|写入 方法遵循通用的 FS 文件系统 read|write 流程
 *
 *
 * dvHdd 磁盘中 文件节点的 _content_ 保存数据结构：
 * !! 根据 mode+type 决定 _content_ 里保存什么数据
 *      reg             普通文件，纯文本内容
 *      reg+ext         带后缀名的普通文件（不是 mime 类型），内容是 json 对象
 *          这类文件以 字符|json对象 形式直接保存在 _content_ 中
 *          运行时由处理程序读取，程序内部 文件内容 缓存在哪里由程序决定
 *          !! 但是如果要修改文件内容，程序在保存之前一定要将修改后的文件内容放到：
 *          !!      此文件的 内存映射节点的 inode._icache_.content 中
 *          !!      后续刷盘时，将根据 _icache_.content 中的内容来修改磁盘中的 _content_
 *
 *      reg+mime        拥有 mime 类型的真实文件，内容可能是大二进制
 *          这类文件通常保存在 云端 | 本地电脑文件系统 | OPFS 等位置
 *          在磁盘节点的 _content_ 中保存的是对应的 url 或 OPFS 路径 字符串
 *          运行时由处理程序读取这里的 url 或 路径字符串，然后读取实际内容，缓存在程序内部，通常
 *          缓存在 程序私有内存中，如果程序需要修改文件内容，通常是：
 *          !!      程序内部 sysCall('fs:save', ipath, 二进制内容)
 *          !!      此文件句柄实例内部不再是写 dvHdd，而是调用对应接口，将文件内容上传至云端，或写回 OPFS
 *          !!      dvHdd 中此文件节点的 _content_ 不会改变
 *
 *
 *
 *
 */

import { ref, reactive, readonly, computed } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import { dvTriggerKernelError } from '../../error'
import {
    type DvFsHddStruct,
    type DvFsMemStruct,
    type DvFsInodeHddStruct,
    type DvFsInodeMemStruct,
    type DvFsInodeCreateOptions,
    dvFsEmptyInodeTime,
    type DvFsSessionIcache,
} from '../types'
import { useDvFsIpath, useDvFsCreate, useDvFsCallCtx, useDvFsConver } from '../utils'
import { dvConfig } from '../../config'
import { useDvMemStore } from './dv-mem'
import { dvIs, dvWait, dvExtend, dvCopy, dvLoget, dvTrimAny } from '@utils/core'

//ipath 工具
const ipu = useDvFsIpath()
//获取 uSign
const { uSign } = useDvFsCallCtx()
//磁盘节点数据 与 内存节点数据 转换方法
const { toMemStruct, toHddStruct } = useDvFsConver()

//快速构建 文件节点 工具
const { inode, dnode, fnode, pnode, sysDir, sysFile } = useDvFsCreate<'hdd'>('hdd')

export const useDvHddStore = defineStore(
    'dvHdd',
    () => {
        //模拟 Linux 系统的 FS 文件系统行为
        //!! 定义 持久化(保存到磁盘 dvHdd)的文件系统
        //!! 在 fs-initing 阶段，会将此处保存的文件系统结构，整体搬到内存树 dvMem.fs
        //!! 在用户登录后 user-initing 阶段，会读取用户空间的目录结构，整体搬到 dvMem.fs.user
        //!!    同时还会读取用户自有的 程序|驱动|mnt节点 等资源，分别挂载到内存树中的对应节点
        const fs = reactive<DvFsHddStruct>(
            sysDir(
                '',
                {},
                {
                    //sys 目录
                    sys: sysDir(
                        'sys',
                        {},
                        {
                            //sys/prog0 系统根程序(0 号进程)
                            prog0: pnode('sys/prog0', 'DvOs', {
                                auth: 101,
                                owner: 'root',
                            }),
                            //sys/config 系统设置 *.conf
                            //!! 系统的原始设置，用户的个性化配置保存在用户空间，不会修改这里
                            //!! 仅在 update 系统更新时，会修改此处的数据
                            //!! 系统运行期间读取的 系统配置 是 合并了 原始配置 和 用户配置之后的最终数据
                            config: sysFile('sys/config', { mime: '*.conf' }, dvConfig),
                            //sys/update 系统更新 *.upd
                            //!! 每次系统启动后，会通过 update 服务检查更新，如果需要更新，会拉区更新数据，保存到这里
                            //!! 执行系统更新时，可能会修改 config 系统原始配置
                            update: sysFile(
                                'sys/update',
                                { mime: '*.upd' },
                                {
                                    //!! 后台拉取的更新包数据
                                    update: {},
                                    hash: '',
                                    //!! 后台拉取的远程配置，用于 远程启停功能，灰度测试 等
                                    remote: {},
                                    remoteHash: '',
                                },
                            ),
                            //sys/session 当前会话状态数据
                            //!! 用户登录之前，此文件保存的是上一次登录用户的信息
                            //用户登录之后，使用当前登录用户的信息修改此文件内容
                            session: sysFile(
                                'sys/session',
                                { mime: '*.session' },
                                {
                                    //DvFsSession
                                },
                            ),
                            //sys/buffer 命令行的 输出缓冲区节点
                            //用于承载 命令行的输入输出 内容，保存在 _icache_.buffer 中
                            //!! 没有 _icache_.content 因此不会被持久化
                            buffer: sysFile('sys/buffer', { mime: '*.buffer' }, ''),
                            //sys/service 系统服务程序挂载点
                            //!! os-mounting 阶段扫描并挂载 系统服务程序节点
                            //!! user-initing 阶段扫描并挂载 业务服务程序节点
                            service: sysDir(
                                'sys/service',
                                {},
                                {
                                    //专门挂载 内核服务的 目录
                                    kernel: sysDir('sys/service/kernel'),
                                },
                            ),
                        },
                    ),
                    //program 程序目录，系统|用户 程序挂载点
                    //!! 仅向内存树输出目录节点，内部子节点不会持久化，仅存在于内存树中
                    //!! os-mounting 阶段扫描并挂载 系统程序节点
                    //!! user-initing 阶段扫描并挂载 用户程序节点
                    program: sysDir('program'),
                    //user 用户目录，所有用户文件挂载点
                    //!! fs-initing 阶段 会将此处定义的固定节点结构，转换挂载到内存节点 dvMem.fs.user
                    //!! user-initing 阶段，会读取用户空间的完整目录结构，转换挂载到内存节点 dvMem.fs.user
                    //!! 用户数据中保存的 系统个性化参数、数据库个性化参数 会一起被搬到内存树
                    //!! 运行时读取 系统设置、数据库设置 会 合并 原始参数和个性化参数，输出合并后的最终数据
                    user: sysDir(
                        'user',
                        {},
                        {
                            //!! 固定的节点，这些节点属于系统节点，用户无法自行修改
                            //user/share 全局用户共享目录
                            share: sysDir('user/share', { inode: { name: '共享' } }),
                            //为每个用户创建指向 dev|mnt 的软连接
                            dev: sysFile(
                                'user/dev',
                                { mode: 'lnk', inode: { name: '设备' } },
                                '/dev',
                            ),
                            mnt: sysFile(
                                'user/mnt',
                                { mode: 'lnk', inode: { name: '位置' } },
                                '/mnt',
                            ),

                            //!! 登录后，用户空间的完整目录结构会挂载到内存树中的这里
                            //config,program,driver,db ...
                        },
                    ),
                    //dev 设备目录，chr 类型文件节点挂载点
                    dev: sysDir(
                        'dev',
                        {},
                        {
                            //dev/usb WebUSB 设备挂载目录
                            //!! 持久化的 usb 节点只保存已经连接过的设备序列号，重启后需要弹出设备列表，由用户选择后重新连接
                            //!! 重连后的设备句柄，保存在内存树中，例如：dvMem.dev.usb.[GP-printer]._icache_.devHandler
                            usb: sysDir('dev/usb'),
                            //dev/driver 系统|用户 驱动类资源挂载目录
                            //!! 此处保存的是全局可用 系统驱动，在 os-mounting 阶段会自动挂载到内存树 dvMem.dev.driver
                            //!! 用户自有的驱动保存在用户空间，在 user-initing 阶段会自动挂载到内存树
                            driver: sysDir('dev/driver'),
                            //dev/clip 剪贴板封装为字符设备节点
                            //!! 仅存在于内存树 dvMem.fs.dev.clipboard 不会持久化
                            //!! 剪贴板全局公用，不区分 用户
                            //clipboard: fnode('dev/clipboard',{mode:'chr',type:'clip',inode:{name: '剪贴板'}}),
                        },
                    ),
                    //mnt 可挂载资源，blk 类型节点挂载点
                    mnt: sysDir(
                        'mnt',
                        {},
                        {
                            //mnt/db 后端 SPF-Orm 数据库资源挂载目录
                            //!! 此处预定义的，以及通过数据库管理器程序手动连接过的 数据库 schema 数据都会持久化到这里
                            //!! fs-initing 阶段会将此处保存的数据库配置，挂载到内存树
                            //!! 系统运行时读取到的 数据库参数，是合并了 此处的原始参数 和 保存在用户目录下的个性化参数 后的最终数据
                            db: sysDir('mnt/db'),
                            //mnt/idb 浏览器本地 IndexedDb 数据库挂载目录
                            idb: sysDir('mnt/idb'),
                            //mnt/local 通过 File System Access API 挂载本机文件
                            local: sysDir('mnt/local'),
                            //mnt/opfs 浏览器本地的 OPFS 文件系统，可存大二进制文件
                            opfs: sysDir(
                                'mnt/opfs',
                                {},
                                {
                                    //mnt/opfs/root 本地 OPFS 根节点，只能 root 访问
                                    root: sysFile(
                                        'mnt/opfs/root',
                                        {
                                            mode: 'blk',
                                            type: 'opfs',
                                        },
                                        {
                                            //保存 OPFS 访问路径
                                            entryPath: '/dv',
                                            //已格式化(初始化)
                                            formatted: false,
                                        },
                                    ),
                                    //mnt/opfs/share 本地 OPFS 的多用户共享节点
                                    share: fnode(
                                        'mnt/opfs/share',
                                        {
                                            mode: 'blk',
                                            type: 'opfs',
                                        },
                                        { entryPath: '/dv/share', formatted: false },
                                    ),
                                    //登录用户自有的 OPFS 储存空间，挂在这里，登录后自动在内存树 dvMem.fs.mnt.opfs 下创建节点 user
                                    //user: fnode('mnt/opfs/user', {mode: 'blk', type: 'opfs'}, {entryPath: '/dv/user/[iso:uuid]'}),
                                },
                            ),
                        },
                    ),
                    //run 网络传输目录，sock 类型节点挂载点
                    //!! 仅向内存树输出目录节点，内部子节点不会持久化，仅存在于内存树中
                    run: sysDir(
                        'run',
                        {},
                        {
                            //run/request 全局请求 挂载为 sock+request 类型
                            request: sysDir('run/request'),
                        },
                    ),
                },
            ),
        )
        //只读
        //const _fs = readonly(fs)

        //磁盘寻址，返回的是 响应式数据
        //!! 磁盘寻址一定传入 ipath，不支持使用 节点显示名称 寻址
        const addr = (ipath: string): DvFsHddStruct | undefined => {
            ipath = ipu.norm(ipath)

            //传入 / 直接返回 fs
            if (ipu.isBase(ipath)) return fs

            //!! 访问用户目录下节点，一定以 /user/ 开头
            if (ipath.startsWith('/user/') || ipath === '/user') {
                //!! 用户必须登录
                const usign = uSign()
                if (!usign) return undefined
                //优先在用户空间查找
                if (userFs?.[usign] && dvIs.nemobj(userFs[usign])) {
                    if (ipath === '/user') return userFs[usign]
                    const rtn = dvLoget(userFs[usign], ipath.slice(6).split('/'))
                    if (rtn !== undefined) return rtn
                }
            }

            //!! 用户路径下不存在，再从顶层查找
            return dvLoget(fs, dvTrimAny(ipath, '/').split('/'))
        }

        //从磁盘结构 构建内存树
        //!! fs-initing 阶段执行，创建 FS 系统内存树
        const mountBaseDir = async (): Promise<boolean> => {
            const dvMem = useDvMemStore()
            const memBase = dvMem.addr('/')
            if (memBase === undefined) {
                dvTriggerKernelError('发生内核错误，文件目录已损坏', 'PANIC')
                return false
            }
            if (dvMem.addr('/sys') !== undefined) {
                //dvTriggerKernelError('发生内核错误，文件目录已创建')
                return true
            }
            //获取 dvHdd 磁盘根目录
            const base = addr('/')
            if (!base || !dvIs.nemobj(base)) {
                dvTriggerKernelError('发生内核错误，磁盘文件目录已损坏', 'PANIC')
                return false
            }
            //获取根目录列表
            const fids = Object.keys(base).filter((i: string) => ipu.isFid(i))
            if (fids.length <= 0) {
                dvTriggerKernelError('发生内核错误，磁盘文件目录已损坏', 'PANIC')
                return false
            }
            //依次挂载内存树根节点
            const errs: string[] = []
            for (const i of fids) {
                const hdd = base[i]
                if (!hdd) continue
                //转换为内存节点，递归转换所有子节点
                const mem = toMemStruct(hdd as DvFsHddStruct, true)
                //挂载到 dvMem
                const mnti = await dvMem.mountInInode(memBase, mem)
                if (!mnti) errs.push(i)
            }

            if (errs.length > 0) {
                dvTriggerKernelError(
                    `发生内核错误，无法挂载这些系统目录 ${errs.join(',')}`,
                    'PANIC',
                )
                return false
            }
            return true
        }

        //定义用户的持久化数据
        //!! 键名是各用户的 uSign
        //!! 值是完整的 用户目录结构，与 dvMem.fs.user 完全镜像
        const userFs = reactive<Record<string, DvFsHddStruct>>({})
        //创建新的用户数据结构，当用户首次登录时执行
        //!! 用户登录后 user-initing 阶段，尝试读取用户空间数据时，如果未找到用户数据，表示这是新用户，需要执行此方法
        //!! 此方法调用时，内存树已经存在，session 文件节点已经创建
        const createUserDir = async (): Promise<boolean> => {
            const usign = uSign()
            //!! 执行此操作时，用户必须已登录
            if (!usign) return false
            //!! 用户数据已存在
            if (userFs[usign] !== undefined) return true

            //获取内存树
            const dvMem = useDvMemStore()
            //读取已存在的 数据库列表
            const dbs = dvMem.fs?.mnt?.db ?? {}
            const dbNodes: Record<string, DvFsHddStruct> = {}
            //获取所有的 数据 key
            const dbks = Object.keys(dbs).filter((i: string) => ipu.isFid(i))
            if (dbks.length > 0) {
                for (const dbk of dbks) {
                    const dbi = dbs?.[dbk]
                    if (!dbi) continue
                    dbNodes[dbk] = toHddStruct(dbi as DvFsMemStruct, true)
                }
            }

            const unode = sysDir(
                'user',
                {},
                {
                    //!! 每个用户都必然存在的文件节点
                    //系统个性化配置
                    config: fnode(
                        'user/config',
                        { mime: '*.conf' },
                        {
                            //!! 与 /sys/config 文件内容结构一致，此处的将 覆盖 系统原始参数
                            //...
                        },
                    ),
                    //用户自行安装的 程序|驱动
                    //!! Deskvue 系统中，用户只能通过 DvAppStore 安装可用的 程序|驱动
                    //!! 这里存放 程序的安装文件 reg+ext 类型，*.progi(程序) | *.drvi(驱动)
                    //!! 在 user-initing 阶段，会读取这里的 程序|驱动 的安装文件，解析后挂载到对应的内存树目录下：
                    //!!    程序挂载到 dvMem.fs.program
                    //!!    驱动挂载到 dvMem.fs.dev.driver
                    program: dnode('user/program'),
                    driver: dnode('user/driver'),
                    //系统中已有的数据库配置，复制一份到用户空间
                    //!! 用户对数据库进行个性化配置，将修改这里的内容
                    db: dnode('user/db', {}, dbNodes),

                    //之后所用用户数据，都在此节点下
                    //...
                },
            )

            //写入
            userFs[usign] = unode
            await dvWait(10)
            return true
        }
        //用户登录后，将 usign 键名下的 user 目录完整的挂载到 内存树中的 user 目录
        //!! dvHdd.userFs.[iso:uuid] 完整的转移到内存树 dvMem.fs.user 目录下
        //!! 在 user-initing 阶段执行，此时内存树目录结构已经存在
        const mountUserDir = async (): Promise<boolean> => {
            const dvMem = useDvMemStore()
            if (!dvMem.fs.user) {
                dvTriggerKernelError('发生内核错误，用户文件目录损坏', 'PANIC')
                return false
            }
            const uMem = dvMem.fs.user as DvFsMemStruct

            //用户必须已登录
            const usign = uSign()
            if (!usign) {
                dvTriggerKernelError('发生内核错误，无法获取登录用户信息', 'PANIC')
                return false
            }

            //用户文件不存在，创建
            if (userFs?.[usign] === undefined) {
                const create = await createUserDir()
                if (!create || !dvIs.nemobj(userFs[usign])) {
                    dvTriggerKernelError('发生内核错误，无法创建用户文件目录', 'PANIC')
                    return false
                }
            }
            if (userFs?.[usign] === undefined || !dvIs.nemobj(userFs[usign])) return false

            //批量挂载到内存树
            const errs: string[] = []
            for (const i in userFs[usign]) {
                const hdd = userFs[usign][i]
                if (!hdd) continue
                //转换为内存节点
                const mem = toMemStruct(hdd as DvFsHddStruct, true)
                //挂载到 dvMem
                const mnti = await dvMem.mountInInode(uMem, mem)
                if (!mnti) errs.push(i)
            }

            if (errs.length > 0) {
                dvTriggerKernelError(
                    `发生内核错误，无法挂载这些用户文件 ${errs.join(',')}`,
                    'PANIC',
                )
                return false
            }

            return true
        }

        //!! 这些方法需要移动到 内存接口中 dvMemStore
        //系统设置数据，如果用户已登录，则会合并用户设置，computed 只读
        /*const sysConfig = computed<PlainObject | undefined>(() => {
            const conf = fs['/sys/config']?._content_
            const usign = uSign()
            if (!usign || !fs[usign]) return conf
            const uconf = fs[usign]['/sys/config'] ?? {}
            //!! dvExtend 会原地修改 target，必须以 {} 作为 target，避免污染全局配置
            return dvExtend({}, conf ?? {}, uconf)
        })
        //数据库|数据模型 schema，如果用户已登录，则会合并用户设置
        const getDbSchema = (db: string, model?: string): PlainObject | undefined => {
            const ipath = `/mnt/${db}${model ? '/' + model : ''}`
            const schema = fs[ipath]
            const usign = uSign()
            if (!usign || !fs[usign]) return schema
            const uschema = fs[usign][ipath] ?? {}
            //!! dvExtend 会原地修改 target，必须以 {} 作为 target，避免污染全局 schema
            return dvExtend({}, schema ?? {}, uschema)
        }
        //用户登录后，获取用户安装的 program 节点列表，返回内存树结构 DvFsMemStruct[]
        const getUserProgramInodes = (): DvFsMemStruct[] => {
            const usign = uSign()
            if (!usign || !fs[usign] || !fs[usign].program) return []
            const uprog = fs[usign].program
            if (!dvIs.nemobj(uprog)) return []
            //将 dvHdd 数据转换为 dvMem 数据
            const rtn: DvFsMemStruct[] = []
            for (const pn in uprog) {
                const pi = uprog[pn]
                if (!pi || !pi._content_) continue
                const mpi = toMemStruct(pi)
                if (!mpi) continue
                rtn.push(mpi)
            }
            return rtn
        }*/

        //写入磁盘

        //将传入的 DvFsMemStruct 内存树节点，按 ipath 写入 dvHdd.fs
        //const fsync = async (ipath: string, fnode: DvFsHddStruct): Promise<boolean> => {
        const fsync = async (inode: DvFsMemStruct): Promise<boolean> => {
            const ipath = inode._ipath_

            //!! 排除 / 和 /*** 系统目录
            if (ipu.isBase(ipath) || ipu.isRoot(ipath)) {
                dvTriggerKernelError('发生内核错误，用户无法修改系统文件')
                return false
            }

            //节点 fid
            const fid = ipu.last(ipath)
            //父路径
            const pp = ipu.parent(ipath)
            //获取父节点
            const pnode = addr(pp)
            if (!pnode) {
                dvTriggerKernelError(`发生内核错误，找不到父目录 ${pp}`)
                return false
            }
            //子节点(已持久化的 要写入的 节点)
            const cnode = pnode?.[fid]
            //内存节点 转为 磁盘节点
            const hdd = toHddStruct(inode, false)

            //如果不存在要写入的节点
            if (!cnode) {
                pnode[fid] = hdd
            }

            //如果节点已存在，合并
            else {
                //pnode[fid] = dvExtend<DvFsHddStruct>(false, cnode, hdd)
                cnode._inode_ = dvExtend<DvFsInodeHddStruct>(false, cnode._inode_, hdd._inode_)
                cnode._content_ = hdd._content_
            }

            await dvWait(10)
            return true
        }

        return {
            fs,

            addr,
            mountBaseDir,

            userFs,
            createUserDir,
            mountUserDir,

            fsync,
        }
    },
    {
        //dvHdd 磁盘数据需要持久化
        persist: true,
    },
)

//返回 store 类型
export type DvHddStore = ReturnType<typeof useDvHddStore>
