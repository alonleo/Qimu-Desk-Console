package com.alon.admin.controller;
import com.alon.admin.entity.*;
import com.alon.admin.mapper.*;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class LegacyOwnerTest {
 private HttpServletRequest request() { User user=new User();user.setId(1L);user.setRole("admin");HttpServletRequest req=mock(HttpServletRequest.class);when(req.getAttribute("currentUser")).thenReturn(user);return req; }
 @Test void knowledgeListAndDetailAcceptSystemDocuments() {
  DocMapper docs=mock(DocMapper.class);Doc doc=new Doc();doc.setId(7L);doc.setTitle("系统文档");doc.setVisibility("public");Page<Doc> page=new Page<>();page.setRecords(List.of(doc));when(docs.selectPage(any(IPage.class),any())).thenReturn(page);when(docs.selectById(7L)).thenReturn(doc);
  KnowledgeController api=new KnowledgeController(docs,mock(CategoryMapper.class),mock(UserMapper.class));
  assertEquals(1,((List<?>)api.list(request(),null,null,null,null,null,null).get("docs")).size());assertEquals(200,api.detail(7L,request()).getStatusCode().value());
 }
 @Test void projectListAcceptsSystemProjects() {
  ProjectMapper projects=mock(ProjectMapper.class);Project p=new Project();p.setId(7L);p.setName("系统项目");when(projects.selectList(any())).thenReturn(List.of(p));
  ProjectController api=new ProjectController(projects,mock(TaskMapper.class),mock(UserMapper.class));assertNull(api.list(request(),null,null,null).get(0).get("owner_name"));
 }
 @Test void skillListAcceptsSeededSkills() {
  SkillMapper skills=mock(SkillMapper.class);Skill s=new Skill();s.setId(7L);s.setName("seed");s.setType("prompt");when(skills.selectList(any())).thenReturn(List.of(s));
  SkillController api=new SkillController(skills,mock(SkillRunMapper.class),null,mock(UserMapper.class),null);assertEquals(1,((List<?>)api.list(request(),null,null).get("skills")).size());
 }
 @Test void workflowListAndDetailAcceptSeededWorkflows() {
  WorkflowMapper workflows=mock(WorkflowMapper.class);RunMapper runs=mock(RunMapper.class);Workflow w=new Workflow();w.setId(7L);w.setName("seed");w.setVisibility("public");when(workflows.selectList(any())).thenReturn(List.of(w));when(workflows.selectById(7L)).thenReturn(w);when(runs.selectPage(any(IPage.class),any())).thenReturn(new Page<Run>());
  WorkflowController api=new WorkflowController(workflows,runs,null,mock(UserMapper.class),null);assertEquals(1,((List<?>)api.list(request(),null,null).get("workflows")).size());assertTrue(api.detail(7L,request()).containsKey("workflow"));
 }
}
