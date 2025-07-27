import json
import base64
import tempfile
import os
import re
from typing import Dict, Any

# for security
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB, but Lambda's request size quota is 6MB, so it won't exceed that
ALLOWED_EXTENSIONS = {'.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.pdf', '.txt', '.md'}

def validate_file_name(filename: str) -> bool:
    if not filename or len(filename) > 255:
        return False

    dangerous_chars = ['..', '/', '\\', ':', '*', '?', '"', '<', '>', '|']
    return not any(char in filename for char in dangerous_chars)

def validate_file_size(file_content: bytes) -> bool:
    return len(file_content) <= MAX_FILE_SIZE

def validate_file_extension(filename: str) -> bool:
    ext = os.path.splitext(filename.lower())[1]
    return ext in ALLOWED_EXTENSIONS

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    try:
        origin = event.get('headers', {}).get('origin', '')
        cors_origin = '*'
        
        headers = {
            'Access-Control-Allow-Origin': cors_origin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-Amz-Date, Authorization, X-Api-Key',
            'Access-Control-Max-Age': '3600',
            'Content-Type': 'application/json',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block',
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
        }
        
        if event.get('httpMethod') == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'message': 'CORS preflight'})
            }
        
        if event.get('httpMethod') != 'POST':
            return {
                'statusCode': 405,
                'headers': headers,
                'body': json.dumps({'error': 'Method not allowed'})
            }
        
        body = event.get('body', '')
        if event.get('isBase64Encoded', False):
            body = base64.b64decode(body).decode('utf-8')
        
        if not body:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': 'Request body is required'})
            }
        
        try:
            request_data = json.loads(body)
        except json.JSONDecodeError:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': 'Invalid JSON in request body'})
            }
        
        file_data = request_data.get('fileData')
        file_name = request_data.get('fileName', 'uploaded_file')
        
        if not file_data:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': 'fileData is required'})
            }
        
        if not validate_file_name(file_name):
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': 'Invalid file name'})
            }
        
        if not validate_file_extension(file_name):
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': 'File type not supported'})
            }
        
        try:
            file_content = base64.b64decode(file_data)
        except Exception as e:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': f'Invalid base64 data'})
            }
        
        if not validate_file_size(file_content):
            return {
                'statusCode': 413,
                'headers': headers,
                'body': json.dumps({'error': f'File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB'})
            }
        
        # create safety temporary file
        file_extension = os.path.splitext(file_name)[1]
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_extension, prefix='markitdown_') as temp_file:
            temp_file.write(file_content)
            temp_file_path = temp_file.name
        
        try:
            try:
                from markitdown import MarkItDown
                
                markitdown = MarkItDown()
                result = markitdown.convert(temp_file_path)
                markdown_content = result.text_content
                
            except ImportError:
                markdown_content = extract_text_fallback(temp_file_path, os.path.splitext(file_name)[1])
            except Exception as e:
                markdown_content = f"# 変換エラー\n\nファイルの変換中にエラーが発生しました: {str(e)}\n\n## ファイル情報\n- ファイル名: {file_name}\n- ファイルサイズ: {len(file_content)} bytes"
        
        finally:
            # delete file anyway
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path)
        
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({
                'success': True,
                'markdown': markdown_content,
                'fileName': file_name
            })
        }
        
    except Exception as e:
        # print(f"Unexpected error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Content-Type': 'application/json',
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY'
            },
            'body': json.dumps({
                'error': 'Internal server error'
            })
        }

def extract_text_fallback(file_path: str, file_extension: str) -> str:
    """
    markitdownが利用できない場合の基本的なテキスト抽出
    """
    try:
        if file_extension.lower() in ['.txt', '.md']:
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
        else:
            file_size = os.path.getsize(file_path)
            return f"""# ファイル情報

- ファイル形式: {file_extension}
- ファイルサイズ: {file_size} bytes

*注意: このファイル形式の内容抽出にはmarkitdownライブラリが必要です。*

## サポート形式
- Microsoft Word (.docx, .doc)
- Microsoft Excel (.xlsx, .xls)
- Microsoft PowerPoint (.pptx, .ppt)
- PDF (.pdf)
- テキストファイル (.txt, .md)

現在のLambda環境では、markitdownライブラリが正しくインストールされていない可能性があります。"""
    except Exception as e:
        return f"# エラー\n\nファイルの読み取りに失敗しました: {str(e)}"
