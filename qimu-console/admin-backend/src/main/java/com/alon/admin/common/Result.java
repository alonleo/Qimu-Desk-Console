package com.alon.admin.common;

import lombok.Data;

/** 统一响应体：{ok, data?, error?}，与前端组件的解析约定对齐 */
@Data
public class Result<T> {
    private boolean ok;
    private T data;
    private String error;

    public static <T> Result<T> ok(T data) {
        Result<T> r = new Result<>();
        r.ok = true;
        r.data = data;
        return r;
    }

    public static Result<Void> ok() {
        Result<Void> r = new Result<>();
        r.ok = true;
        return r;
    }

    public static <T> Result<T> fail(String error) {
        Result<T> r = new Result<>();
        r.ok = false;
        r.error = error;
        return r;
    }
}
