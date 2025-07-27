FROM --platform=linux/amd64 public.ecr.aws/lambda/python:3.13

# 作業ディレクトリの作成
WORKDIR ${LAMBDA_TASK_ROOT}

# 基本的な依存関係とmarkitdownをインストール
RUN pip install --no-cache-dir --upgrade pip && \
    pip install markitdown[all]

# Lambda関数のコードをコピー
COPY lambda_function.py lambda_function.py

# Lambda関数のハンドラーを指定
CMD ["lambda_function.lambda_handler"]
