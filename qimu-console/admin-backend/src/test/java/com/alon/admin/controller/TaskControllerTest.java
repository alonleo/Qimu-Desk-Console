package com.alon.admin.controller;
import com.alon.admin.common.TaskRules;
import com.alon.admin.entity.*;
import com.alon.admin.mapper.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import jakarta.servlet.http.HttpServletRequest;
import java.time.LocalDateTime;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class TaskControllerTest {
 TaskMapper tasks; ProjectMapper projects; UserMapper users; TaskController api; User actor; HttpServletRequest req;
 @BeforeEach void setup(){ tasks=mock(TaskMapper.class);projects=mock(ProjectMapper.class);users=mock(UserMapper.class);api=new TaskController(tasks,projects,users);actor=new User();actor.setId(1L);actor.setRole("member");req=mock(HttpServletRequest.class);when(req.getAttribute("currentUser")).thenReturn(actor); }
 Task task(){Task t=new Task();t.setId(5L);t.setTitle("Review");t.setStatus("todo");t.setPriority("normal");t.setVisibility("public");t.setOwnerId(1L);when(tasks.selectById(5L)).thenReturn(t);return t;}
 @Test void clearsProjectDatesAndAssignee(){Task t=task();t.setProjectId(2L);t.setDueDate("2026-09-30");t.setAssigneeId(2L);Map<String,Object> patch=new HashMap<>();patch.put("projectId",null);patch.put("dueDate",null);patch.put("assigneeId",null);api.update(5L,patch,req);assertNull(t.getProjectId());assertNull(t.getDueDate());assertNull(t.getAssigneeId());verify(tasks).updateById(t);}
 @Test void reopeningClearsCompletion(){Task t=task();t.setStatus("done");t.setCompletedAt(LocalDateTime.now());api.update(5L,Map.of("status","doing"),req);assertNull(t.getCompletedAt());}
 @Test void repeatedCompletionPreservesTime(){Task t=task();t.setStatus("done");var time=LocalDateTime.of(2026,9,1,12,0);t.setCompletedAt(time);api.update(5L,Map.of("status","done"),req);assertEquals(time,t.getCompletedAt());}
 @Test void assigneeCanChangeOnlyStatus(){Task t=task();t.setOwnerId(2L);t.setAssigneeId(1L);when(users.selectById(1L)).thenReturn(actor);assertEquals(200,api.update(5L,Map.of("status","doing"),req).getStatusCode().value());assertEquals(403,api.update(5L,Map.of("title","hijack"),req).getStatusCode().value());assertEquals(403,api.delete(5L,req).getStatusCode().value());}
 @Test void unrelatedMemberCannotWrite(){Task t=task();t.setOwnerId(2L);assertEquals(403,api.update(5L,Map.of("status","done"),req).getStatusCode().value());verify(tasks,never()).updateById(any(Task.class));}
 @Test void invalidCalendarDateRejected(){Task t=task();assertThrows(IllegalArgumentException.class,()->api.update(5L,Map.of("dueDate","2026-02-30"),req));verify(tasks,never()).updateById(any(Task.class));}
 @Test void dateRangeRejected(){Task t=task();assertThrows(IllegalArgumentException.class,()->api.update(5L,Map.of("startDate","2026-09-30","dueDate","2026-09-01"),req));}
 @Test void invalidEnumsRejected(){Task t=task();t.setStatus(null);assertThrows(IllegalArgumentException.class,()->TaskRules.validate(t));t.setStatus("deleted");assertThrows(IllegalArgumentException.class,()->TaskRules.validate(t));}
 @Test void dailyAcceptsTimeAndRejectsDate(){Task t=task();t.setPeriod("daily");t.setStartDate("08:30");t.setDueDate("12:30");assertDoesNotThrow(()->TaskRules.validate(t));t.setDueDate("2026-09-27");assertThrows(IllegalArgumentException.class,()->TaskRules.validate(t));}
 @Test void personalTaskCannotBeAssignedToAnotherMember(){Task t=task();t.setVisibility("personal");t.setAssigneeId(2L);assertThrows(IllegalArgumentException.class,()->TaskRules.validate(t));}
 @Test void inaccessibleProjectRejected(){Task t=task();Project p=new Project();p.setId(9L);p.setVisibility("personal");p.setOwnerId(3L);p.setStatus("active");when(projects.selectById(9L)).thenReturn(p);assertThrows(IllegalArgumentException.class,()->api.update(5L,Map.of("projectId",9),req));}
 @Test void batchReportsPartialFailures(){Task t=task();Task foreign=new Task();foreign.setId(6L);foreign.setOwnerId(2L);when(tasks.selectById(6L)).thenReturn(foreign);var result=api.batchUpdate(Map.of("ids",List.of(5,6),"data",Map.of("status","doing")),req);assertEquals(1,result.get("updated"));assertEquals(1,result.get("failed"));verify(tasks).updateById(t);verify(tasks,never()).updateById(foreign);}
 @Test void nullOwnerDoesNotBreakSerialization(){Task t=task();t.setOwnerId(null);assertDoesNotThrow(()->TaskController.toRow(t,Map.of()));}
}
