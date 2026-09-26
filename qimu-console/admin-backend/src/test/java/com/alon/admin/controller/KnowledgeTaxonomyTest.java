package com.alon.admin.controller;

import com.alon.admin.entity.User;
import com.alon.admin.entity.Doc;
import com.alon.admin.mapper.*;
import com.alon.admin.service.KnowledgeTagService;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class KnowledgeTaxonomyTest {
    private HttpServletRequest request(String role) {
        User user = new User(); user.setId(7L); user.setRole(role);
        HttpServletRequest req = mock(HttpServletRequest.class);
        when(req.getAttribute("currentUser")).thenReturn(user); return req;
    }
    @Test void sharedTagsRequireAdminForCreateAndDelete() {
        KnowledgeTagService service = mock(KnowledgeTagService.class);
        KnowledgeTagController api = new KnowledgeTagController(service);
        assertEquals(403, api.create(Map.of("name", "测试"), request("member")).getStatusCode().value());
        assertEquals(403, api.delete("测试", request("member")).getStatusCode().value());
        verifyNoInteractions(service);
    }
    @Test void tagNamesRejectEmptyDelimiterAndControlCharacters() {
        KnowledgeTagService service = mock(KnowledgeTagService.class);
        KnowledgeTagController api = new KnowledgeTagController(service);
        for (String name : List.of(" ", "甲,乙", "甲；乙", "甲\n乙", "字".repeat(31))) {
            assertEquals(400, api.create(Map.of("name", name), request("admin")).getStatusCode().value(), name);
        }
        verifyNoInteractions(service);
    }
    @Test void duplicateTagsReturnConflictAndCreationTrimsName() {
        KnowledgeTagService service = mock(KnowledgeTagService.class);
        KnowledgeTagController api = new KnowledgeTagController(service);
        when(service.create("空标签")).thenReturn(true);
        assertEquals(200, api.create(Map.of("name", " 空标签 "), request("admin")).getStatusCode().value());
        assertEquals(409, api.create(Map.of("name", "已有标签"), request("admin")).getStatusCode().value());
    }
    @Test void unusedTagsPersistAndMemberCountsOnlyUseVisibleDocuments() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList("SELECT name FROM knowledge_tags ORDER BY name", String.class)).thenReturn(List.of("空标签"));
        when(jdbc.queryForList("SELECT tags FROM docs WHERE visibility='public' OR owner_id=?", String.class, 7L)).thenReturn(List.of("API,API,其他", "API"));
        User member = new User(); member.setId(7L); member.setRole("member");
        var result = new KnowledgeTagService(jdbc).list(member);
        assertTrue(result.contains(Map.of("name", "空标签", "count", 0L)));
        assertTrue(result.contains(Map.of("name", "API", "count", 2L)));
        verify(jdbc, never()).queryForList("SELECT tags FROM docs", String.class);
    }
    @Test void tagDeletionPreservesOtherTagsAndRemovesDuplicateMatches() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList("SELECT id, tags FROM docs WHERE FIND_IN_SET(?, tags) > 0 FOR UPDATE", "API"))
                .thenReturn(List.of(Map.of("id", 3L, "tags", "API,API 网关,API,其他")));
        when(jdbc.update("UPDATE docs SET tags=?, updated_at=NOW() WHERE id=?", "API 网关,其他", 3L)).thenReturn(1);
        assertEquals(1, new KnowledgeTagService(jdbc).delete("API"));
        verify(jdbc).update("UPDATE docs SET tags=?, updated_at=NOW() WHERE id=?", "API 网关,其他", 3L);
        verify(jdbc).update("DELETE FROM knowledge_tags WHERE name=?", "API");
    }
    @Test void categoryWritesRejectMembersIncludingBatchAndRename() {
        CategoryMapper categories = mock(CategoryMapper.class); DocMapper docs = mock(DocMapper.class);
        KnowledgeController api = new KnowledgeController(docs, categories, mock(UserMapper.class), mock(KnowledgeTagService.class));
        var req = request("member");
        assertThrows(ResponseStatusException.class, () -> api.createCategory(Map.of("name", "测试"), req));
        assertThrows(ResponseStatusException.class, () -> api.deleteCategoryByName("测试", req));
        assertThrows(ResponseStatusException.class, () -> api.deleteCategory(1L, req));
        assertThrows(ResponseStatusException.class, () -> api.renameCategory(1L, Map.of("name", "测试"), req));
        assertThrows(ResponseStatusException.class, () -> api.batchCreateCategories(Map.of("items", List.of("测试")), req));
        assertThrows(ResponseStatusException.class, () -> api.batchDeleteCategories(Map.of("ids", List.of(1)), req));
        verifyNoInteractions(categories, docs);
    }
    @Test void defaultCategoryCannotBeDeletedAndReservedNamesCannotBeCreated() {
        CategoryMapper categories = mock(CategoryMapper.class); DocMapper docs = mock(DocMapper.class);
        KnowledgeController api = new KnowledgeController(docs, categories, mock(UserMapper.class), mock(KnowledgeTagService.class));
        assertTrue(api.deleteCategoryByName("未分类", request("admin")).containsKey("error"));
        assertTrue(api.createCategory(Map.of("name", "all"), request("admin")).containsKey("error"));
        Map<String,Object> empty = new HashMap<>(); empty.put("name", null);
        assertTrue(api.createCategory(empty, request("admin")).containsKey("error"));
        verifyNoInteractions(categories, docs);
    }
    @Test void deletingLegacyCategoryMovesDocumentsWithoutDeletingThem() {
        com.baomidou.mybatisplus.core.metadata.TableInfoHelper.initTableInfo(
                new org.apache.ibatis.builder.MapperBuilderAssistant(new com.baomidou.mybatisplus.core.MybatisConfiguration(), "taxonomy-test"), Doc.class);
        CategoryMapper categories = mock(CategoryMapper.class); DocMapper docs = mock(DocMapper.class);
        when(docs.update(isNull(), any(Wrapper.class))).thenReturn(2);
        KnowledgeController api = new KnowledgeController(docs, categories, mock(UserMapper.class), mock(KnowledgeTagService.class));
        assertEquals(2, api.deleteCategoryByName("旧分类", request("admin")).get("moved"));
        verify(docs).update(isNull(), any(Wrapper.class));
        verify(docs, never()).delete(any(Wrapper.class));
        verify(categories).delete(any(Wrapper.class));
    }
}
