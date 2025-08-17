import './style.scss'

const fileInput = document.getElementById('file-input') as HTMLInputElement;
const fileInputText = document.querySelector('.file-input-text') as HTMLSpanElement;
const metaView = document.getElementById('meta-view') as HTMLDivElement;


// MIDIメタイベントタイプ
const META_EVENT_TYPES: Record<number, string> = {
  0x03: '曲名', // Sequence/Track Name
  0x02: '著作権', // Copyright Notice
  0x01: 'テキスト', // Text Event
  0x05: '歌詞', // Lyrics
  0x06: 'マーカー', // Marker
  0x07: 'キューポイント', // Cue Point
};

// XFインフォメーション項目
const XF_INFO_TYPES: Record<string, string[]> = {
  XFhd: [
    'ID',
    '発表年月日',
    '制作地',
    '曲のジャンル',
    'リズムのビート',
    'メロディーパートの主な楽器',
    '歌唱タイプ',
    '作曲者',
    '作詞者',
    '編曲者',
    '演奏者/歌唱者',
    '楽曲データ制作者',
    'キーワード',
  ],
  XFln: [
    'ID',
    '言語情報',
    '曲名',
    '作曲者',
    '作詞者',
    '編曲者',
    '演奏者/歌唱者',
    '楽曲データ制作者',
  ]
};

// 可変長値のデコード
function readVarLen(data: Uint8Array, offset: number): { value: number, next: number } {
  let value = 0;
  let i = offset;
  while (true) {
    const b = data[i++];
    value = (value << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) break;
  }
  return { value, next: i };
}

const parseMidi = (data: Uint8Array) => {
  const isMidi =  data[0] === 0x4d && data[1] === 0x54 && data[2] === 0x68 && data[3] === 0x64;
  if (!isMidi) {
    throw new Error('MIDIファイルではありません。');
  }

  // トラックごとのメタ情報リスト
  const trackMetaList: { track: number, meta: ({ type: string, text: string } | { type: 'XF', info: { 共通: { type: string, text: string }[], 言語別: { type: string, text: string }[] } })[] }[] = [];

  // ヘッダチャンクをスキップ
  let offset = 14; // MThd(4) + size(4) + format(2) + ntrks(2) + division(2)
  let trackCount = 0;
  while (offset < data.length) {
    // チャンクの先頭を探す
    if (!(data[offset] === 0x4d && data[offset+1] === 0x54 && data[offset+2] === 0x72 && data[offset+3] === 0x6b /* MTrk */
      || data[offset] === 0x58 && data[offset+1] === 0x46 && data[offset+2] === 0x49 && data[offset+3] === 0x48 /* XFIH */)) {
      offset++;
      continue;
    }
    // チャンクサイズ
    const chunkSize = (data[offset+4]<<24) | (data[offset+5]<<16) | (data[offset+6]<<8) | (data[offset+7]);
    let i = offset + 8;
    const end = i + chunkSize;
    let metaList: ({ type: string, text: string } | { type: 'XF', info: { 共通: { type: string, text: string }[], 言語別: { type: string, text: string }[] } })[] = [];
    let runningStatus = 0;
    while (i < end) {
      // delta time
      const { next: afterDelta } = readVarLen(data, i);
      i = afterDelta;
      let status = data[i];
      if (status < 0x80) {
        // running status
        status = runningStatus;
      } else {
        i++;
        runningStatus = status;
      }
      if (status === 0xff) {
        // meta event
        const metaType = data[i++];
        const { value: len, next: afterLen } = readVarLen(data, i);
        i = afterLen;
        if (META_EVENT_TYPES[metaType]) {
          const type = (() => {
            if (trackCount > 0 && META_EVENT_TYPES[metaType] === '曲名') {
              return 'トラック名';
            }
            return META_EVENT_TYPES[metaType];
          })();
          const text = new TextDecoder('Shift-JIS').decode(data.slice(i, i+len));
          const firstFourChars = text.slice(0, 4);
          if (firstFourChars === 'XFhd' || firstFourChars === 'XFln') {
            // XF項目を共通・言語別で分けて格納
            const infoItems = text.split(':');
            const types = XF_INFO_TYPES[firstFourChars];
            const typeString = firstFourChars === 'XFhd' ? '共通' : '言語別';
            // XF構造をmetaListに格納
            let xfInfo = { 共通: [] as { type: string, text: string }[], 言語別: [] as { type: string, text: string }[] };
            for (const [index, item] of infoItems.entries()) {
              if (index > 0 && types[index] && item) {
                xfInfo[typeString].push({ type: types[index], text: item });
              }
            }
            // 既存のXF構造があればマージ
            const last = metaList[metaList.length - 1];
            if (last && last.type === 'XF') {
              (last as any).info[typeString].push(...xfInfo[typeString]);
            } else {
              metaList.push({ type: 'XF', info: xfInfo });
            }
          } else {
            if (text) {
              metaList.push({ type, text });
            }
          }
        }
        // トラック終端イベントならbreak
        if (metaType === 0x2f && len === 0) {
          break;
        }
        i += len;
      } else if (status >= 0x80 && status <= 0xef) {
        // MIDIイベント
        const eventType = status & 0xf0;
        if (eventType === 0xc0 || eventType === 0xd0) {
          i += 1;
        } else {
          i += 2;
        }
      } else if (status === 0xf0 || status === 0xf7) {
        // SysExイベント
        const { value: len, next: afterLen } = readVarLen(data, i);
        i = afterLen + len;
      } else {
        // 不明なイベント
        i++;
      }
    }
    trackMetaList.push({ track: trackCount + 1, meta: metaList });
    trackCount++;
    offset = end;
  }

  // metaViewをクリア
  metaView.textContent = '';
  let hasMeta = false;
  for (const track of trackMetaList) {
    if (track.meta.length === 0) continue;
    hasMeta = true;
    const fieldset = document.createElement('fieldset');
    const trackTitle = document.createElement('legend');
    trackTitle.textContent = `Track ${track.track}`;
    fieldset.appendChild(trackTitle);
    const dl = document.createElement('dl');
    for (const meta of track.meta) {
      if (meta.type === 'XF') {
        // XF項目をdlの入れ子で表示
        const xf = (meta as any).info;
        for (const key of ['共通', '言語別'] as const) {
          if (xf[key].length > 0) {
            const dt = document.createElement('dt');
            dt.textContent = `XF項目（${key}）`;
            dl.appendChild(dt);
            const dd = document.createElement('dd');
            const innerDl = document.createElement('dl');
            for (const item of xf[key]) {
              const innerDt = document.createElement('dt');
              innerDt.textContent = item.type;
              const innerDd = document.createElement('dd');
              innerDd.textContent = item.text;
              innerDl.appendChild(innerDt);
              innerDl.appendChild(innerDd);
            }
            dd.appendChild(innerDl);
            dl.appendChild(dd);
          }
        }
      } else if ('text' in meta) {
        const dt = document.createElement('dt');
        dt.textContent = meta.type;
        const dd = document.createElement('dd');
        dd.textContent = meta.text;
        dl.appendChild(dt);
        dl.appendChild(dd);
      }
    }
    fieldset.appendChild(dl);
    metaView.appendChild(fieldset);
  }
  if (!hasMeta) {
    metaView.textContent = 'メタ情報が見つかりませんでした。';
  }
};

const initialFileInputText = fileInputText.textContent;
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (file) {
    fileInputText.textContent = file.name;
    const binaryArray = new Uint8Array(await file.arrayBuffer());
    try {
      parseMidi(binaryArray);
    } catch (e: any) {
      metaView.textContent = e.message || 'MIDIファイルの解析に失敗しました。';
    }
  } else {
    fileInputText.textContent = initialFileInputText;
    metaView.textContent = '';
  }
});