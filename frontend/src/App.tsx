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

  const getApiUrl = () => {
    const baseUrl = process.env.REACT_APP_API_ENDPOINT || '/maibe-failed-to-build';
    return baseUrl.replace(/\/$/, '');
  };

  const checkFileSize = (file: File): boolean => {
    const estimatedBase64Size = file.size * 1.37; // Base64は約37%増加
    const maxSizeInBytes = 6 * 1024 * 1024; // 6MB
    
    if (estimatedBase64Size > maxSizeInBytes) {
      setError(`ファイルサイズが大きすぎます。推定Base64サイズ: ${(estimatedBase64Size / (1024 * 1024)).toFixed(2)}MB（上限: 6MB）`);
      return false;
    }
    return true;
  };

  const checkBase64Size = (base64Data: string): boolean => {
    const base64SizeInBytes = base64Data.length * 0.75; // Base64は約4/3倍になるので、元のサイズを概算
    const maxSizeInBytes = 6 * 1024 * 1024; // 6MB
    
    if (base64SizeInBytes > maxSizeInBytes) {
      setError(`ファイルサイズが大きすぎます。Base64エンコード後のサイズが6MBを超えています。現在のサイズ: ${(base64SizeInBytes / (1024 * 1024)).toFixed(2)}MB`);
      return false;
    }
    return true;
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
      const file = files[0];
      
      if (checkFileSize(file)) {
        handleFile(file);
      }
    }
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      
      if (checkFileSize(file)) {
        handleFile(file);
      }
    }
  }, []);

  const handleFile = async (file: File) => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const fileData = await fileToBase64(file);
      
      const base64Data = fileData.split(',')[1]; // data:xxxの部分を除去
      
      if (!checkBase64Size(base64Data)) {
        return;
      }
      
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileData: base64Data,
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
              <p className="size-limit">
                ファイルサイズ上限: 約5MB
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
