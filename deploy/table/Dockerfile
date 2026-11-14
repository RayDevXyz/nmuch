# BrainWaves table server. Build from the repository root:
#   docker build -f deploy/table/Dockerfile -t brainwaves-table .
FROM rust:1-bookworm AS build
WORKDIR /src
COPY . .
RUN cargo build --release -p bw-table

FROM debian:bookworm-slim
RUN useradd --system --uid 10001 table && mkdir /data && chown table /data
COPY --from=build /src/target/release/bw-table /usr/local/bin/bw-table
USER table
ENV BW_TABLE_DATA=/data BW_TABLE_PORT=8090
EXPOSE 8090
VOLUME /data
HEALTHCHECK --interval=30s --timeout=3s CMD bash -c 'exec 3<>/dev/tcp/127.0.0.1/8090 && printf "GET /health HTTP/1.0\r\n\r\n" >&3 && grep -q ok <&3'
CMD ["bw-table"]
