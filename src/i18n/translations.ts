export type Lang = 'zh' | 'en';

export const translations = {
  zh: {
    appName: '免费全球Radio',
    tabs: {
      explore:   '发现',
      search:    '搜索',
      favorites: '收藏',
    },
    genres: {
      all:        '全部',
      pop:        '流行',
      rock:       '摇滚',
      jazz:       '爵士',
      classical:  '古典',
      electronic: '电子',
      news:       '新闻',
      talk:       '谈话',
      country:    '乡村',
      hiphop:     '嘻哈',
    },
    bitrate: {
      all:   '全部音质',
      label: (k: number) => `${k}k+`,
    },
    player: {
      playing:             '播放中',
      loading:             '缓冲中...',
      idle:                '已停止',
      error:               '播放出错',
      normalize:           '均衡',
      normalizeUnavailable:'均衡不可用',
      stop:                '⏹ 停止',
      volume:              '音量',
    },
    search: {
      placeholder: '搜索电台名称、国家、类型...',
      button:      '搜索',
      results:     (q: string, n: number) => `"${q}" 共找到 ${n} 个电台`,
    },
    station: {
      addFav:    '收藏',
      removeFav: '取消收藏',
      play:      '播放',
      stop:      '停止',
    },
    empty: {
      favorites: '还没有收藏的电台，去「发现」或「搜索」页添加吧',
      search:    '请输入关键词搜索电台',
      explore:   '暂无电台',
    },
    error: {
      load:   '无法加载电台列表，请检查网络连接后重试。',
      search: '搜索失败，请稍后重试。',
    },
  },

  en: {
    appName: 'Free Global Radio',
    tabs: {
      explore:   'Explore',
      search:    'Search',
      favorites: 'Favorites',
    },
    genres: {
      all:        'All',
      pop:        'Pop',
      rock:       'Rock',
      jazz:       'Jazz',
      classical:  'Classical',
      electronic: 'Electronic',
      news:       'News',
      talk:       'Talk',
      country:    'Country',
      hiphop:     'Hip-Hop',
    },
    bitrate: {
      all:   'All Quality',
      label: (k: number) => `${k}k+`,
    },
    player: {
      playing:             'Playing',
      loading:             'Buffering…',
      idle:                'Stopped',
      error:               'Playback error',
      normalize:           'Normalized',
      normalizeUnavailable:'No normalization',
      stop:                '⏹ Stop',
      volume:              'Volume',
    },
    search: {
      placeholder: 'Search by name, country or genre…',
      button:      'Search',
      results:     (q: string, n: number) => `Found ${n} station${n !== 1 ? 's' : ''} for "${q}"`,
    },
    station: {
      addFav:    'Add to favorites',
      removeFav: 'Remove from favorites',
      play:      'Play',
      stop:      'Stop',
    },
    empty: {
      favorites: 'No favorites yet — browse Explore or Search to add some!',
      search:    'Enter a keyword to find stations',
      explore:   'No stations found',
    },
    error: {
      load:   'Could not load stations. Please check your connection.',
      search: 'Search failed. Please try again.',
    },
  },
} as const;

export type T = typeof translations.zh;
