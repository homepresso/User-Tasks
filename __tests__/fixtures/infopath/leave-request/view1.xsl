<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:my="http://schemas.microsoft.com/office/infopath/2003/myXSD/2026-02-03T09:30:00" xmlns:xd="http://schemas.microsoft.com/office/infopath/2003" xmlns:xdFormatting="http://schemas.microsoft.com/office/infopath/2003/xslt/formatting">
	<xsl:output method="html" indent="no"/>
	<xsl:template match="my:leaveRequest">
		<html><head><meta http-equiv="Content-Type" content="text/html"></meta></head>
			<body>
				<div><font size="4"><strong>Leave request</strong></font></div>
				<div>Fill in this form at least two weeks before planned leave.</div>
				<table class="xdLayout" style="WIDTH: 640px" border="1">
					<tbody vAlign="top">
						<tr>
							<td><div>Full name:</div></td>
							<td><span class="xdTextBox" hideFocus="1" tabIndex="0" xd:xctname="PlainText" xd:CtrlId="CTRL1" xd:binding="my:employee/my:fullName" style="WIDTH: 100%"><xsl:value-of select="my:employee/my:fullName"/></span></td>
							<td><div>Employee ID:</div></td>
							<td><span class="xdTextBox" hideFocus="1" title="E followed by five digits" tabIndex="0" xd:xctname="PlainText" xd:CtrlId="CTRL2" xd:binding="my:employee/my:employeeId" style="WIDTH: 100%"><xsl:value-of select="my:employee/my:employeeId"/></span></td>
						</tr>
						<tr>
							<td><div>Type of leave:</div></td>
							<td colSpan="3"><div>
								<input class="xdBehavior_Boolean" type="radio" xd:xctname="OptionButton" xd:CtrlId="CTRL3" xd:binding="my:leaveType" xd:onValue="Annual" xd:boundProp="xd:value" tabIndex="0"><xsl:attribute name="xd:value"><xsl:value-of select="my:leaveType"/></xsl:attribute></input> Annual leave
								<input class="xdBehavior_Boolean" type="radio" xd:xctname="OptionButton" xd:CtrlId="CTRL4" xd:binding="my:leaveType" xd:onValue="Sick" xd:boundProp="xd:value" tabIndex="0"><xsl:attribute name="xd:value"><xsl:value-of select="my:leaveType"/></xsl:attribute></input> Sick leave
								<input class="xdBehavior_Boolean" type="radio" xd:xctname="OptionButton" xd:CtrlId="CTRL5" xd:binding="my:leaveType" xd:onValue="Unpaid" xd:boundProp="xd:value" tabIndex="0"><xsl:attribute name="xd:value"><xsl:value-of select="my:leaveType"/></xsl:attribute></input> Unpaid leave
							</div></td>
						</tr>
						<tr>
							<td><div>From:</div></td>
							<td><div class="xdDTPicker" noWrap="1" xd:xctname="DTPicker" xd:CtrlId="CTRL6"><span class="xdDTText" hideFocus="1" contentEditable="true" tabIndex="0" xd:xctname="DTPicker_DTText" xd:binding="my:startDate" xd:innerCtrl="_DTText" xd:datafmt="&quot;date&quot;,&quot;dateFormat:Short Date;&quot;"><xsl:value-of select="my:startDate"/></span><button class="xdDTButton" xd:xctname="DTPicker_DTButton" xd:innerCtrl="_DTButton"></button></div></td>
							<td><div>To:</div></td>
							<td><div class="xdDTPicker" noWrap="1" xd:xctname="DTPicker" xd:CtrlId="CTRL7"><span class="xdDTText" hideFocus="1" contentEditable="true" tabIndex="0" xd:xctname="DTPicker_DTText" xd:binding="my:endDate" xd:innerCtrl="_DTText" xd:datafmt="&quot;date&quot;,&quot;dateFormat:Short Date;&quot;"><xsl:value-of select="my:endDate"/></span><button class="xdDTButton" xd:xctname="DTPicker_DTButton" xd:innerCtrl="_DTButton"></button></div></td>
						</tr>
						<tr>
							<td><div>Working days:</div></td>
							<td><span class="xdTextBox xdBehavior_Formatting" hideFocus="1" tabIndex="0" xd:xctname="PlainText" xd:CtrlId="CTRL8" xd:binding="my:days" xd:datafmt="&quot;number&quot;,&quot;numDigits:1;&quot;" style="WIDTH: 100%"><xsl:value-of select="my:days"/></span></td>
							<td><div>Best time to call:</div></td>
							<td><span class="xdTextBox xdBehavior_Formatting" hideFocus="1" tabIndex="0" xd:xctname="PlainText" xd:CtrlId="CTRL9" xd:binding="my:callTime" xd:datafmt="&quot;time&quot;,&quot;timeFormat:h:mm AM/PM;&quot;" style="WIDTH: 100%"><xsl:value-of select="my:callTime"/></span></td>
						</tr>
						<tr>
							<td><div>Reason:</div></td>
							<td colSpan="3"><span class="xdTextBox" hideFocus="1" tabIndex="0" xd:xctname="PlainText" xd:CtrlId="CTRL10" xd:binding="my:reason" style="WIDTH: 100%; HEIGHT: 60px; WHITE-SPACE: normal"><xsl:value-of select="my:reason"/></span></td>
						</tr>
					</tbody>
				</table>
				<div><xsl:apply-templates select="my:medical" mode="_1"/>
					<xsl:if test="not(my:medical)"><div class="optionalPlaceholder" xd:xmlToEdit="medical_1" tabIndex="0" xd:action="xOptional::insert">Click here to add medical details</div></xsl:if>
				</div>
				<div><input type="button" value="Send for approval" xd:xctname="Button" xd:CtrlId="CTRL30" tabIndex="0"/></div>
			</body>
		</html>
	</xsl:template>
	<xsl:template match="my:medical" mode="_1">
		<xsl:if test="not(../my:leaveType != &quot;Sick&quot;)">
			<div class="xdSection xdRepeating" title="Medical details" style="WIDTH: 640px" align="left" xd:xctname="Section" xd:CtrlId="CTRL11" tabIndex="-1">
				<div><strong>Medical details</strong></div>
				<div>Doctor:</div>
				<div><span class="xdTextBox" hideFocus="1" tabIndex="0" xd:xctname="PlainText" xd:CtrlId="CTRL12" xd:binding="my:doctor" style="WIDTH: 100%"><xsl:value-of select="my:doctor"/></span></div>
				<div>Medical certificate:</div>
				<div><span class="xdFileAttachment" hideFocus="1" tabIndex="0" xd:xctname="FileAttachment" xd:CtrlId="CTRL13" xd:binding="my:certificate"></span></div>
			</div>
		</xsl:if>
	</xsl:template>
</xsl:stylesheet>
