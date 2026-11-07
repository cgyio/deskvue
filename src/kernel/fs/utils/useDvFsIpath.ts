/**
 * Deskvue kernel
 * Deskvue 模拟 Linux 文件系统的部分行为
 *
 * 文件节点的 ipath 全局唯一路径字符串 以及 [fid] 文件节点键名 或 _inode_.name 文件显示名称 处理
 */

import { dvFsFidKeywords, type DvFsMemStruct } from '../types'
import { dvIs, dvTrimAny } from '@utils/core'

export const useDvFsIpath = () => {
    //ipath 处理
    //规范化 ipath：确保以 / 开头，去除首尾多余的 /
    const norm = (ipath: string): string => {
        ipath = ipath.trim()
        //根目录
        if (ipath === '' || ipath === '/') return '/'
        return `/${dvTrimAny(ipath, '/')}`
    }
    //解析 ipath 中的 . / .. 路径段，返回标准化的绝对路径
    const resolve = (ipath: string): string => {
        ipath = norm(ipath)
        if (ipath === '/') return '/'
        const segs: string[] = []
        for (const seg of dvTrimAny(ipath, '/').split('/')) {
            //空段 或 . 跳过（. 表示当前目录）
            if (seg === '' || seg === '.') continue
            //.. 返回上级目录，超过根目录时保持在根目录
            if (seg === '..') {
                if (segs.length > 0) segs.pop()
                continue
            }
            segs.push(seg)
        }
        if (segs.length === 0) return '/'
        return '/' + segs.join('/')
    }
    //拼接子节点 ipath：/foo/bar + baz -> /foo/bar/baz
    //!! name 可以是带 / 的相对路径，也可包含 . / .. 路径段
    const join = (parent: string, name: string): string => {
        parent = norm(parent)
        name = norm(name)
        if (parent === '/') return resolve(name)
        return resolve(parent + name)
    }
    //获取 ipath 的 第一段 /foo/bar/jaz --> foo
    const first = (ipath: string): string => {
        ipath = norm(ipath)
        //全局根目录 base 返回 ''
        if (ipath === '/') return ''
        const ipa = dvTrimAny(ipath, '/').split('/')
        if (ipa.length <= 0 || !ipa[0]) return ''
        return ipa[0]
    }
    //获取 ipath 的 最后一段（树中的存储 key）
    const last = (ipath: string): string => {
        ipath = norm(ipath)
        //全局根目录 base 返回 ''
        if (ipath === '/') return ''
        const i = ipath.lastIndexOf('/')
        return i < 0 ? ipath : ipath.slice(i + 1)
    }
    //获取 父节点 ipath，根节点（父级为 /）返回 '/'
    const parent = (ipath: string): string => {
        ipath = norm(ipath)
        //全局根目录 base 返回 ''
        if (ipath === '/') return ''
        const i = ipath.lastIndexOf('/')
        //root 根节点（父级为 /）返回 '/'
        return i <= 0 ? '/' : ipath.slice(0, i)
    }
    //判断 是否全局根节点 base /
    const isBase = (ipath: string): boolean => norm(ipath) === '/'
    //判断 是否根节点（父级为 /）
    const isRoot = (ipath: string): boolean => parent(ipath) === '/'
    //返回 ipath 路径深度
    const deep = (ipath: string): number => {
        if (isBase(ipath)) return 0
        if (isRoot(ipath)) return 1
        const ipa = dvTrimAny(norm(ipath), '/').split('/')
        return ipa.length
    }

    //[fid] 或 _inode_.name 显示名称

    //判断一个字符串是否可以作为子节点键名 [fid]
    //!! create 新建文件节点时，传入的 name 必须符合此要求
    //!! rename 改名时，传入的 name 不需要符合此要求，理论上 _inode_.name 显示名称可以是任意字符
    const isFid = (name: string): boolean => {
        return !dvFsFidKeywords.includes(name) && !name.includes('/')
    }
    //判断 inode 节点中是否包含子节点 fid
    const hasFid = (inode: DvFsMemStruct, name: string): boolean => {
        //必须传入有效的 fid
        if (!isFid(name)) return false
        return Object.prototype.hasOwnProperty.call(inode, name)
    }

    //传入 name 文件名处理，返回标准结构 {ext: boolean, extn: '实际后缀字符', rname: '去除后缀后的文件名'}
    const parseExt = (
        name: string,
    ): {
        ext: boolean
        extn?: string //!! 不带 .
        rname: string //!! 截取后的文件名未经 isFid 检查
    } => {
        //!! .foo|foo.|foo.bar. = 不带后缀，.foo.bar = 带 .bar 后缀
        const i = name.lastIndexOf('.')
        const len = name.length
        const ext = i > 0 && i < len - 1

        //不带后缀
        if (!ext) {
            return {
                ext,
                rname: name,
            }
        }

        //带后缀
        return {
            ext,
            extn: name.slice(i + 1),
            rname: name.slice(0, i),
        }
    }

    //判断 inode 节点的 mime 或 后缀名
    const extIs = (inode: DvFsMemStruct, ext?: string): boolean => {
        if (!inode._inode_.extra || !inode._inode_.extra.mime) return false
        if (!ext || !dvIs.nemstr(ext)) return false
        const mime = inode._inode_.extra.mime
        return mime === ext || mime === `*.${ext}`
    }

    return {
        norm,
        resolve,
        join,
        first,
        last,
        parent,
        isBase,
        isRoot,
        deep,

        isFid,
        hasFid,
        parseExt,
        extIs,
    }
}

//工具类型
export type DvFsIpathHook = ReturnType<typeof useDvFsIpath>
