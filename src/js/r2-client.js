import { AwsClient } from 'aws4fetch'
import { PAGE_SIZE } from './constants.js'
import { encodeS3Key } from './utils.js'
import { ConfigManager } from './config-manager.js'
const API_URL = window.location.origin

/** @typedef {{ key: string; isFolder: boolean; size?: number; lastModified?: string }} FileItem */

class R2Client {
  /** @type {AwsClient | null} */
  #client = null
  /** @type {ConfigManager | null} */
  #config = null

  /** @param {ConfigManager} configManager */
  init(configManager) {
    this.#config = configManager
    /*const cfg = configManager.get()
    this.#client = new AwsClient({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      service: 's3',
      region: 'auto',
    })*/
  }

  /** @param {string} [prefix] @param {string} [continuationToken] */
  async listObjects(prefix = '', continuationToken = '') {
    const url = new URL(`${API_URL}/api/files`)

    if (prefix) {
      url.searchParams.set('prefix', prefix)
    }

    const res = await fetch(url)

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }

    const data = await res.json()

    const folders = new Map()
    const files = []

    for (const item of data.files || []) {
      const relative = prefix
        ? item.key.slice(prefix.length)
        : item.key

      if (!relative) continue

      const slash = relative.indexOf('/')

      if (slash !== -1) {
        const folderName = relative.slice(0, slash + 1)

        folders.set(folderName, {
          key: prefix + folderName,
          isFolder: true,
        })
      } else {
        files.push({
          key: item.key,
          size: item.size,
          lastModified: item.uploaded,
          isFolder: false,
        })
      }
    }

    return {
      folders: [...folders.values()],
      files,
      isTruncated: false,
      nextToken: '',
    }
  }

  /**
   * 检查对象是否存在，使用 ListObjectsV2 避免 HEAD 404 污染控制台
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async fileExists(key) {
  const url = new URL(`${API_URL}/api/files`)
  url.searchParams.set('prefix', key)

  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }

  const data = await res.json()

  return (data.files || []).some((file) => file.key === key)
}

  /** @param {string} key @param {string} contentType */
  async putObjectSigned(key, contentType) {
  const res = await fetch(`${API_URL}/api/upload-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      key,
      contentType,
    }),
  })

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }

  const data = await res.json()

  return {
    url: data.uploadUrl,
    headers: {
      'Content-Type': contentType,
    },
  }
}

  /** @param {string} key */
  async getObject(key) {
  const url = new URL(`${API_URL}/api/download`)
  url.searchParams.set('key', key)

  const res = await fetch(url)

  if (!res.ok) {
    if (res.status === 404) throw new Error('HTTP_404')
    throw new Error(`HTTP ${res.status}`)
  }

  return res
}

  /** @param {string} key */
  async getPresignedUrl(key) {
  const url = new URL(`${API_URL}/api/download`)
  url.searchParams.set('key', key)

  return url.toString()
}

  /** @param {string} key @param {string} filename */
  async getDownloadUrl(key, filename) {
  const url = new URL(`${API_URL}/api/download`)
  url.searchParams.set('key', key)
  url.searchParams.set('download', '1')

  return url.toString()
}

  /** @param {string} key */
  getPublicUrl(key) {
  const url = new URL(`${API_URL}/api/download`)
  url.searchParams.set('key', key)

  return url.toString()
}

  /** @param {string} key */
  async headObject(key) {
    const url = `${/** @type {ConfigManager} */ (this.#config).getBucketUrl()}/${encodeS3Key(key)}`
    const res = await /** @type {AwsClient} */ (this.#client).fetch(url, { method: 'HEAD' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return {
      contentType: res.headers.get('content-type'),
      contentLength: parseInt(res.headers.get('content-length') || '0', 10),
      lastModified: res.headers.get('last-modified'),
      etag: res.headers.get('etag'),
    }
  }

  /** @param {string} key */
  async deleteObject(key) {
  const url = new URL(`${API_URL}/api/file`)
  url.searchParams.set('key', key)

  const res = await fetch(url, {
    method: 'DELETE',
  })

  if (!res.ok) {
    if (res.status === 404) throw new Error('HTTP_404')
    throw new Error(`HTTP ${res.status}`)
  }
}

  /** @param {string} src @param {string} dest */
  async copyObject(src, dest) {
  const res = await fetch(`${API_URL}/api/copy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      src,
      dest,
    }),
  })

  if (!res.ok) {
    if (res.status === 404) throw new Error('HTTP_404')
    throw new Error(`HTTP ${res.status}`)
  }
}

  /** @param {string} key @param {string} contentType */
  async updateContentType(key, contentType) {
    const cfg = /** @type {ConfigManager} */ (this.#config).get()
    const url = `${/** @type {ConfigManager} */ (this.#config).getBucketUrl()}/${encodeS3Key(key)}`
    const res = await /** @type {AwsClient} */ (this.#client).fetch(url, {
      method: 'PUT',
      headers: {
        'x-amz-copy-source': `/${cfg.bucket}/${encodeS3Key(key)}`,
        'x-amz-metadata-directive': 'REPLACE',
        'Content-Type': contentType,
      },
    })
    if (!res.ok) {
      if (res.status === 401) throw new Error('HTTP_401')
      if (res.status === 403) throw new Error('HTTP_403')
      if (res.status === 404) throw new Error('HTTP_404')
      throw new Error(`HTTP ${res.status}`)
    }
  }

  /** @param {string} prefix */
  async createFolder(prefix) {
  const key = prefix.endsWith('/') ? prefix : prefix + '/'

  const res = await fetch(`${API_URL}/api/folder`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ key }),
  })

  if (!res.ok) {
    if (res.status === 404) throw new Error('HTTP_404')
    throw new Error(`HTTP ${res.status}`)
  }
}
}

export { R2Client }
