<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:my="http://schemas.microsoft.com/office/infopath/2003/myXSD/2026-03-04T08:00:00" xmlns:xd="http://schemas.microsoft.com/office/infopath/2003" xmlns:pc="http://schemas.microsoft.com/office/infopath/2007/PartnerControls">
	<xsl:output method="html" indent="no"/>
	<xsl:template match="my:siteInspection">
		<html><head></head><body>
			<div><img src="logo.png" alt="Acme Facilities" style="WIDTH: 120px"/></div>
			<div><font size="4"><strong>Site inspection</strong></font></div>
			<table class="xdLayout" style="WIDTH: 700px" border="1"><tbody vAlign="top">
				<tr>
					<td><div>Inspector:</div><span class="xdTextBox" xd:xctname="PlainText" xd:CtrlId="CTRL1" xd:binding="my:inspector"><xsl:value-of select="my:inspector"/></span></td>
					<td><div>Site:</div><span class="xdTextBox" xd:xctname="PlainText" xd:CtrlId="CTRL2" xd:binding="my:siteName"><xsl:value-of select="my:siteName"/></span></td>
				</tr>
				<tr>
					<td><div>Date:</div><div class="xdDTPicker" xd:xctname="DTPicker" xd:CtrlId="CTRL3"><span class="xdDTText" xd:xctname="DTPicker_DTText" xd:binding="my:inspectionDate" xd:innerCtrl="_DTText"><xsl:value-of select="my:inspectionDate"/></span></div></td>
					<td><div>Status:</div><select class="xdComboBox" xd:xctname="dropdown" xd:CtrlId="CTRL4" xd:binding="my:status"><xsl:attribute name="style">WIDTH: 100%;<xsl:choose><xsl:when test="my:status = &quot;Fail&quot;">COLOR: #ff0000;FONT-WEIGHT: bold;caption: Failed in red</xsl:when><xsl:when test="my:status = &quot;Pending&quot;">BACKGROUND-COLOR: #ffcc00;caption: Pending shaded</xsl:when></xsl:choose></xsl:attribute>
						<option value="Pending">Pending</option><option value="Pass">Pass</option><option value="Fail">Fail</option></select></td>
				</tr>
				<tr>
					<td><div>Summary:</div><span class="xdExpressionBox" xd:xctname="ExpressionBox" xd:CtrlId="CTRL5"><xsl:value-of select="concat(substring-before(my:inspector, &quot;@&quot;), &quot; / &quot;, my:siteName)"/></span></td>
					<td><div>Failed checks:</div><span class="xdExpressionBox" xd:xctname="ExpressionBox" xd:CtrlId="CTRL6"><xsl:value-of select="count(my:items/my:item[my:result = &quot;Fail&quot;])"/></span></td>
				</tr>
				<tr>
					<td><div>Regions:</div><div class="xdMultiSelectList" xd:xctname="multipleselectlist" xd:CtrlId="CTRL7" xd:binding="my:regions/my:region">
						<div><input type="checkbox" xd:onValue="North" xd:xctname="CheckBox"/>North</div><div><input type="checkbox" xd:onValue="South" xd:xctname="CheckBox"/>South</div><div><input type="checkbox" xd:onValue="West" xd:xctname="CheckBox"/>West</div></div></td>
					<td><div>Site owner:</div><object class="xdActiveX" classid="clsid:61e40d31-993d-4777-8fa0-19ca59b6d0bb" xd:xctname="{{61e40d31-993d-4777-8fa0-19ca59b6d0bb}}" xd:CtrlId="CTRL8" xd:binding="my:owner"></object></td>
				</tr>
				<tr>
					<td><div>Follow-up actions:</div><ul class="xdBulletedList" xd:xctname="BulletedList" xd:CtrlId="CTRL9" xd:binding="my:actions/my:action"><li><span xd:binding="."/></li></ul></td>
					<td><div>Reference:</div><span class="xdHyperlink" xd:xctname="Hyperlink" xd:CtrlId="CTRL10" xd:binding="my:referenceUrl"></span></td>
				</tr>
				<tr>
					<td colSpan="2"><div>Notes:</div><span class="xdRichTextBox" xd:xctname="RichText" xd:CtrlId="CTRL11" xd:binding="my:notes"><xsl:copy-of select="my:notes/node()"/></span></td>
				</tr>
				<tr>
					<td colSpan="2"><div>Site photo:</div><span class="xdInlinePicture" xd:xctname="InlineImage" xd:CtrlId="CTRL12" xd:binding="my:sitePhoto"></span></td>
				</tr>
			</tbody></table>
			<div><strong>Checks</strong></div>
			<table class="xdRepeatingTable" xd:CtrlId="CTRL20" border="1">
				<tbody class="xdTableHeader"><tr><td>Area</td><td>Result</td><td>Score</td><td>Findings</td></tr></tbody>
				<tbody xd:xctname="RepeatingTable"><xsl:for-each select="my:items/my:item"><tr>
					<td><span class="xdTextBox" xd:xctname="PlainText" xd:CtrlId="CTRL21" xd:binding="my:area"><xsl:value-of select="my:area"/></span></td>
					<td><select class="xdComboBox" xd:xctname="dropdown" xd:CtrlId="CTRL22" xd:binding="my:result"><xsl:attribute name="style"><xsl:choose><xsl:when test="my:result = &quot;Fail&quot;">COLOR: #cc0000;FONT-WEIGHT: bold</xsl:when></xsl:choose></xsl:attribute><option value="Pass">Pass</option><option value="Fail">Fail</option></select></td>
					<td><span class="xdTextBox" xd:xctname="PlainText" xd:CtrlId="CTRL23" xd:binding="my:score" xd:datafmt="&quot;number&quot;,&quot;numDigits:0;&quot;"><xsl:value-of select="my:score"/></span></td>
					<td><table class="xdRepeatingTable" xd:CtrlId="CTRL24" border="1">
						<tbody class="xdTableHeader"><tr><td>Finding</td><td>Severity</td></tr></tbody>
						<tbody xd:xctname="RepeatingTable"><xsl:for-each select="my:findings/my:finding"><tr>
							<td><span class="xdTextBox" xd:xctname="PlainText" xd:CtrlId="CTRL25" xd:binding="my:description"><xsl:value-of select="my:description"/></span></td>
							<td><select class="xdComboBox" xd:xctname="dropdown" xd:CtrlId="CTRL26" xd:binding="my:severity"><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option></select></td>
						</tr></xsl:for-each></tbody></table></td>
				</tr></xsl:for-each></tbody>
			</table>
			<div><strong>Hazards</strong></div>
			<div><xsl:apply-templates select="my:hazards/my:hazard" mode="_1"/></div>
			<div><strong>How should we contact the owner?</strong></div>
			<div><xsl:choose>
				<xsl:when test="my:contact/my:byPhone"><xsl:apply-templates select="my:contact/my:byPhone" mode="_3"/></xsl:when>
				<xsl:when test="my:contact/my:byEmail"><xsl:apply-templates select="my:contact/my:byEmail" mode="_4"/></xsl:when>
			</xsl:choose></div>
			<table class="xdLayout" border="1"><tbody><tr>
				<td><div>Reviewed by:</div><span class="xdTextBox" xd:xctname="PlainText" xd:CtrlId="CTRL40" xd:binding="my:reviewedBy" xd:disableEditing="yes"><xsl:value-of select="my:reviewedBy"/></span></td>
				<td><div>Sketch:</div><span class="xdInkPicture" xd:xctname="InkPicture" xd:CtrlId="CTRL41" xd:binding="my:sketch"></span></td>
			</tr></tbody></table>
		</body></html>
	</xsl:template>
	<xsl:template match="my:hazard" mode="_1">
		<div class="xdRepeatingSection xdRepeating" xd:xctname="RepeatingSection" xd:CtrlId="CTRL30" title="Hazard">
			<table class="xdLayout" border="1"><tbody><tr>
				<td><div>Hazard:</div><span class="xdTextBox" xd:xctname="PlainText" xd:CtrlId="CTRL31" xd:binding="my:hazardTitle"><xsl:value-of select="my:hazardTitle"/></span></td>
				<td><div>Level:</div><select class="xdComboBox" xd:xctname="dropdown" xd:CtrlId="CTRL32" xd:binding="my:level"><xsl:attribute name="style"><xsl:choose><xsl:when test="my:level = &quot;High&quot;">BACKGROUND-COLOR: #ffd7d7;caption: High hazards in red</xsl:when></xsl:choose></xsl:attribute><option value="Low">Low</option><option value="High">High</option></select></td>
			</tr><tr>
				<td colSpan="2"><div>Photo:</div><span class="xdInlinePicture" xd:xctname="InlineImage" xd:CtrlId="CTRL33" xd:binding="my:hazardPhoto"></span></td>
			</tr></tbody></table>
			<div><xsl:apply-templates select="my:controls/my:control" mode="_2"/></div>
		</div>
	</xsl:template>
	<xsl:template match="my:control" mode="_2">
		<div class="xdRepeatingSection xdRepeating" xd:xctname="RepeatingSection" xd:CtrlId="CTRL34" title="Control measure">
			<div>Control measure:</div><span class="xdTextBox" xd:xctname="PlainText" xd:CtrlId="CTRL35" xd:binding="my:measure"><xsl:value-of select="my:measure"/></span>
		</div>
	</xsl:template>
	<xsl:template match="my:byPhone" mode="_3">
		<div class="xdSection xdRepeating" xd:xctname="ChoiceSection" xd:CtrlId="CTRL36" title="By phone"><div>Phone:</div><span class="xdTextBox" xd:xctname="PlainText" xd:CtrlId="CTRL37" xd:binding="my:phone"><xsl:value-of select="my:phone"/></span></div>
	</xsl:template>
	<xsl:template match="my:byEmail" mode="_4">
		<div class="xdSection xdRepeating" xd:xctname="ChoiceSection" xd:CtrlId="CTRL38" title="By email"><div>Email:</div><span class="xdTextBox" xd:xctname="PlainText" xd:CtrlId="CTRL39" xd:binding="my:email"><xsl:value-of select="my:email"/></span></div>
	</xsl:template>
</xsl:stylesheet>
