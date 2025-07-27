import React, { useState, useCallback } from 'react';
import './App.css';

interface ConversionResult {
  success: boolean;
  markdown: string;
  fileName: string;
  error?: string;
}

function App() {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 環境変数からAPI URLを取得
  const getApiUrl = () => {
    const baseUrl = process.env.REACT_APP_API_ENDPOINT || '/maibe-failed-to-build';
    // 末尾のスラッシュを削除
    return baseUrl.replace(/\/$/, '');
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFile(files[0]);
    }
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  }, []);

  const handleFile = async (file: File) => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      // ファイルをBase64に変換
      const fileData = await fileToBase64(file);
      
      // API呼び出し
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileData: fileData.split(',')[1], // data:xxxの部分を除去
          fileName: file.name
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result: ConversionResult = await response.json();
      
      if (result.success) {
        setResult(result);
      } else {
        setError(result.error || '変換に失敗しました');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '不明なエラーが発生しました');
    } finally {
      setIsLoading(false);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const copyToClipboard = async () => {
    if (result?.markdown) {
      try {
        await navigator.clipboard.writeText(result.markdown);
        alert('マークダウンをクリップボードにコピーしました！');
      } catch (err) {
        alert('クリップボードへのコピーに失敗しました');
      }
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>MarkItDown Web Service</h1>
        <p>ファイルをドラッグ&ドロップするか、クリックしてファイルを選択してください</p>
      </header>

      <main className="App-main">
        <div
          className={`file-drop-area ${isDragOver ? 'drag-over' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => document.getElementById('file-input')?.click()}
        >
          {isLoading ? (
            <div className="loading">
              <div className="spinner"></div>
              <p>ファイルを変換中...</p>
            </div>
          ) : (
            <>
              <div className="upload-icon">📁</div>
              <p>ファイルをここにドロップまたはクリック</p>
              <p className="supported-formats">
                サポート形式: Word (.docx, .doc), Excel (.xlsx, .xls), PowerPoint (.pptx, .ppt), PDF (.pdf), テキスト (.txt, .md)
              </p>
            </>
          )}
          <input
            id="file-input"
            type="file"
            style={{ display: 'none' }}
            onChange={handleFileInput}
            accept=".docx,.doc,.xlsx,.xls,.pptx,.ppt,.pdf,.txt,.md"
          />
        </div>

        {error && (
          <div className="error-message">
            <h3>エラー</h3>
            <p>{error}</p>
          </div>
        )}

        {result && (
          <div className="result-area">
            <div className="result-header">
              <h3>変換結果: {result.fileName}</h3>
              <button onClick={copyToClipboard} className="copy-button">
                📋 クリップボードにコピー
              </button>
            </div>
            <div className="markdown-output">
              <pre>{result.markdown}</pre>
            </div>
          </div>
        )}
      </main>

      <footer className="App-footer">
        <p>Powered by MarkItDown</p>
      </footer>
    </div>
  );
}

export default App;
