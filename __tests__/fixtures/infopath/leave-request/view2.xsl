<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:my="http://schemas.microsoft.com/office/infopath/2003/myXSD/2026-02-03T09:30:00" xmlns:xd="http://schemas.microsoft.com/office/infopath/2003" xmlns:xdFormatting="http://schemas.microsoft.com/office/infopath/2003/xslt/formatting">
	<xsl:output method="html" indent="no"/>
	<xsl:template match="my:leaveRequest">
		<html><head></head>
			<body>
				<div><font size="4"><strong>Manager approval</strong></font></div>
				<table class="xdLayout" style="WIDTH: 640px" border="1">
					<tbody vAlign="top">
						<tr>
							<td><div>Employee:</div></td>
							<td><span class="xdExpressionBox xdDataBindingUI" xd:xctname="ExpressionBox" xd:CtrlId="CTRL31" xd:disableEditing="yes" tabIndex="-1"><xsl:value-of select="concat(my:employee/my:fullName, &quot; (&quot;, my:employee/my:employeeId, &quot;)&quot;)"/></span></td>
						</tr>
						<tr>
							<td><div>Dates:</div></td>
							<td><span class="xdTextBox" hideFocus="1" tabIndex="-1" xd:xctname="PlainText" xd:CtrlId="CTRL32" xd:binding="my:startDate" xd:disableEditing="yes"><xsl:value-of select="my:startDate"/></span> to <span class="xdTextBox" hideFocus="1" tabIndex="-1" xd:xctname="PlainText" xd:CtrlId="CTRL33" xd:binding="my:endDate" xd:disableEditing="yes"><xsl:value-of select="my:endDate"/></span></td>
						</tr>
						<tr>
							<td><div>Status:</div></td>
							<td><span class="xdExpressionBox" xd:xctname="ExpressionBox" xd:CtrlId="CTRL34" tabIndex="-1"><xsl:value-of select="my:status"/></span></td>
						</tr>
						<tr>
							<td><div>Decision:</div></td>
							<td><select class="xdComboBox xdBehavior_Select" size="1" tabIndex="0" xd:xctname="dropdown" xd:CtrlId="CTRL35" xd:binding="my:approval/my:decision" style="WIDTH: 100%">
								<option><xsl:if test="my:approval/my:decision=&quot;&quot;"><xsl:attribute name="selected">selected</xsl:attribute></xsl:if>Choose…</option>
								<option value="Approved">Approve</option>
								<option value="Rejected">Reject</option>
							</select></td>
						</tr>
						<tr>
							<td><div>Comments:</div></td>
							<td><span class="xdRichTextBox" hideFocus="1" tabIndex="0" xd:xctname="RichText" xd:CtrlId="CTRL36" xd:binding="my:approval/my:comments" style="WIDTH: 100%"><xsl:copy-of select="my:approval/my:comments/node()"/></span></td>
						</tr>
						<tr>
							<td><div>Decided on:</div></td>
							<td><span class="xdTextBox" hideFocus="1" tabIndex="-1" xd:xctname="PlainText" xd:CtrlId="CTRL37" xd:binding="my:approval/my:approvedOn" xd:disableEditing="yes" xd:datafmt="&quot;date&quot;,&quot;dateFormat:Short Date;&quot;"><xsl:value-of select="my:approval/my:approvedOn"/></span></td>
						</tr>
					</tbody>
				</table>
				<div><input type="button" value="Record decision" xd:xctname="Button" xd:CtrlId="CTRL40" tabIndex="0"><xsl:attribute name="xd:disableEditing"><xsl:choose><xsl:when test="my:approval/my:decision = &quot;&quot;">yes</xsl:when></xsl:choose></xsl:attribute></input>
					<input type="button" value="Back to request" xd:xctname="Button" xd:CtrlId="CTRL41" tabIndex="0"/></div>
			</body>
		</html>
	</xsl:template>
</xsl:stylesheet>
